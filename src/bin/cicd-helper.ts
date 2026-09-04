/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: GitHub Actions workflow templates use ${{ }} syntax */
import { github } from 'projen';
import { getTaskName } from './env-helper';

const COMMON_RUNS_ON = ['ubuntu-latest'];
/** Pinned GitHub Actions used by every workflow in this repo. */
export const GITHUB_ACTIONS = {
  checkout: 'actions/checkout@v7',
  setupNode: 'actions/setup-node@v7',
  setupPnpm: 'pnpm/action-setup@v6',
  configureAwsCredentials: 'aws-actions/configure-aws-credentials@v6',
  cdkDiffPrCommenter: 'towardsthecloud/aws-cdk-diff-pr-commenter@v1',
  createPullRequest: 'peter-evans/create-pull-request@v8',
  downloadArtifact: 'actions/download-artifact@v8',
  semanticPullRequest: 'amannn/action-semantic-pull-request@v6',
  uploadArtifact: 'actions/upload-artifact@v7',
} as const;

/**
 * Registers `GITHUB_ACTIONS` with projen's actions provider so projen-managed workflows
 * (build, release, upgrade, pull-request-lint) render the same versions as the workflows built here.
 */
export function pinGithubActions(gh: github.GitHub): void {
  for (const action of Object.values(GITHUB_ACTIONS)) {
    gh.actions.set(action.split('@')[0], action);
  }
}
const BRANCH_EXCLUSIONS = ['main', 'hotfix/*', 'github-actions/*', 'dependabot/**'];
/** Standard permissions required for CDK deployment workflows. */
const COMMON_WORKFLOW_PERMISSIONS = {
  contents: github.workflows.JobPermission.READ,
  idToken: github.workflows.JobPermission.WRITE,
};

/**
 * Creates a GitHub workflow that validates the CDK app offline on pull requests.
 *
 * Runs the root `validate` task (`cdk validate --no-online`) so pull requests are checked
 * against the default rule set without AWS credentials.
 *
 * @param gh - An instance of the `github.GitHub` class, used to create the GitHub workflow.
 * @param nodeVersion - The version of Node.js to be used.
 * @returns The created `github.GithubWorkflow` instance.
 */
export function createCdkValidateWorkflow(gh: github.GitHub, nodeVersion: string): github.GithubWorkflow {
  const workflow = new github.GithubWorkflow(gh, 'cdk-validate');

  workflow.on({
    pullRequest: {},
    workflowDispatch: {},
  });

  workflow.addJobs({
    validate: {
      name: 'Validate CDK app offline',
      runsOn: COMMON_RUNS_ON,
      permissions: {
        contents: github.workflows.JobPermission.READ,
      },
      steps: [
        ...getCommonWorkflowSteps(nodeVersion),
        {
          name: 'Validate CDK app against the default rule set',
          run: 'pnpm run validate',
        },
      ],
    },
  });

  return workflow;
}

/**
 * Creates a GitHub workflow for generating CDK diff on pull requests.
 *
 * This workflow triggers on pull_request_target events to the main branch and:
 * - Checks out the PR branch
 * - Runs CDK diff against the highest environment in orderedEnvironments
 * - Posts the diff as a comment on the pull request
 *
 * @param gh - An instance of the `github.GitHub` class, used to create the GitHub workflow.
 * @param account - The AWS account ID to compare against.
 * @param region - The AWS region to use for the diff.
 * @param githubDeployRole - The name of the GitHub deploy role.
 * @param nodeVersion - The version of Node.js to be used.
 * @param orderedEnvironments - An array of environment names in deployment order. The last environment will be used for the diff.
 * @returns The created `github.GithubWorkflow` instance.
 */
export function createCdkDiffPrWorkflow(
  gh: github.GitHub,
  account: string,
  region: string,
  githubDeployRole: string,
  nodeVersion: string,
  orderedEnvironments: string[],
): github.GithubWorkflow {
  const workflowName = 'cdk-diff-pr-comment';
  const cdkDiffWorkflow = new github.GithubWorkflow(gh, workflowName);

  // Get the highest environment (last in the ordered list)
  const highestEnv = orderedEnvironments[orderedEnvironments.length - 1] || 'production';

  const workflowTriggers = {
    pullRequestTarget: {
      branches: ['main'],
    },
  };

  cdkDiffWorkflow.on(workflowTriggers);

  // Extend common permissions with PR write access for posting comments
  const diffWorkflowPermissions = {
    ...COMMON_WORKFLOW_PERMISSIONS,
    pullRequests: github.workflows.JobPermission.WRITE,
  };

  const commonSteps = getCommonWorkflowSteps(
    nodeVersion,
    account,
    region,
    githubDeployRole,
    '${{ github.event.pull_request.head.sha }}',
  );

  const diffSteps: github.workflows.Step[] = [
    {
      name: `Validate CDK for the ${highestEnv.toUpperCase()} environment`,
      run: `pnpm run ${getTaskName(highestEnv, 'validate')}`,
    },
    {
      name: 'CDK diff and notify PR',
      run: `pnpm run ${getTaskName(highestEnv, 'diff', { taskType: 'all' })} > cdk-diff-output.txt 2>&1 || true`,
    },
    {
      name: 'Post CDK Diff Comment in PR',
      uses: GITHUB_ACTIONS.cdkDiffPrCommenter,
      with: {
        'diff-file': 'cdk-diff-output.txt',
        'aws-region': `${region}`,
        header: `CDK Diff for ${highestEnv} in ${region}`,
      },
    },
  ];

  cdkDiffWorkflow.addJobs({
    diff: {
      name: `CDK diff PR branch with ${highestEnv} environment (via main)`,
      runsOn: COMMON_RUNS_ON,
      permissions: diffWorkflowPermissions,
      env: {
        AWS_REGION: region,
      },
      steps: [...commonSteps, ...diffSteps],
    },
  });

  return cdkDiffWorkflow;
}

/**
 * Creates GitHub workflows for deploying and destroying AWS CDK stacks.
 *
 * Creates different workflow configurations based on the environment and branch deployment settings:
 * - Always creates a regular deployment workflow for the environment
 * - If deployForBranch=true, also creates branch deployment and destroy workflows
 * - Production environments get concurrency limits to prevent parallel deployments
 *
 * @param gh - An instance of the `github.GitHub` class, used to create the GitHub workflows.
 * @param account - The AWS account ID to which the CDK stacks will be deployed.
 * @param region - The AWS region to which the CDK stacks will be deployed.
 * @param env - The environment (e.g., "test", "staging", "production") for which the CDK stacks will be deployed.
 * @param githubDeployRole - The name of the GitHub deploy role.
 * @param nodeVersion - The version of Node.js to be used for the deployment.
 * @param deployForBranch - A boolean flag that determines whether the deployment should be done for a feature branch or the main branch.
 * @param orderedEnvironments - An array of environment names in the order they should be deployed, used for creating chained workflows.
 */
export function createCdkDeploymentWorkflows(
  gh: github.GitHub,
  account: string,
  region: string,
  env: string,
  githubDeployRole: string,
  nodeVersion: string,
  deployForBranch = false,
  orderedEnvironments: string[] = [],
) {
  // Always create the regular deployment workflow
  createCdkDeploymentWorkflow(gh, account, region, env, githubDeployRole, nodeVersion, false, orderedEnvironments);

  if (deployForBranch) {
    // Create the branch deployment workflow
    createCdkDeploymentWorkflow(gh, account, region, env, githubDeployRole, nodeVersion, true);
    // Create the destroy workflow for branch deployments
    createCdkDestroyWorkflow(gh, account, region, env, githubDeployRole, nodeVersion);
  }
}

/**
 * Creates a GitHub workflow for deploying the CDK stacks to the AWS account.
 * @param gh - An instance of the `github.GitHub` class, used to create the GitHub workflow.
 * @param account - The AWS account ID to which the CDK stacks will be deployed.
 * @param region - The AWS region to which the CDK stacks will be deployed.
 * @param env - The environment (e.g., "test", "staging", "production") for which the CDK stacks will be deployed.
 * @param githubDeployRole - The name of the GitHub deploy role.
 * @param nodeVersion - The version of Node.js to be used for the deployment.
 * @param deployForBranch - A boolean flag that determines whether the deployment should be done for a feature branch or the main branch.
 * @param orderedEnvironments - An array of environment names in the order they should be deployed, used for creating chained workflows.
 * @returns The created `github.GithubWorkflow` instance.
 */
function createCdkDeploymentWorkflow(
  gh: github.GitHub,
  account: string,
  region: string,
  env: string,
  githubDeployRole: string,
  nodeVersion: string,
  deployForBranch: boolean,
  orderedEnvironments: string[] = [],
): github.GithubWorkflow {
  const workflowName = `cdk-deploy-${env}${deployForBranch ? '-branch' : ''}`;
  const cdkDeploymentWorkflow = new github.GithubWorkflow(gh, workflowName, {
    limitConcurrency: true,
    concurrencyOptions: {
      group: '${{ github.workflow }}-${{ github.ref_name }}',
      cancelInProgress: false,
    },
  });

  const workflowTriggers: Record<string, unknown> = {
    workflowDispatch: {}, // Always allow manual workflow dispatch
  };

  if (deployForBranch) {
    workflowTriggers.push = { branches: ['**', ...BRANCH_EXCLUSIONS.map((branch) => `!${branch}`)] };
  } else {
    const currentEnvIndex = orderedEnvironments.indexOf(env);
    if (currentEnvIndex === 0) {
      // First environment in the order, trigger on push to main
      workflowTriggers.push = { branches: ['main'] };
    } else if (currentEnvIndex > 0) {
      // Not the first environment, trigger on completion of the previous environment's workflow
      const previousEnv = orderedEnvironments[currentEnvIndex - 1];
      workflowTriggers.workflowRun = {
        workflows: [`cdk-deploy-${previousEnv}`],
        types: ['completed'],
      };
    }
  }

  cdkDeploymentWorkflow.on(workflowTriggers);

  const commonWorkflowSteps = getCommonWorkflowSteps(nodeVersion, account, region, githubDeployRole);

  const deploymentSteps: github.workflows.Step[] = [
    {
      name: `Validate CDK for the ${env.toUpperCase()} environment`,
      run: `pnpm run ${getTaskName(env, 'validate', { isBranch: deployForBranch })}`,
    },
    {
      name: `Deploy CDK to the ${env.toUpperCase()} environment on AWS account ${account}`,
      run: `pnpm run ${getTaskName(env, 'deploy', { isBranch: deployForBranch, taskType: 'all' })}`,
    },
  ];

  const jobConfig: github.workflows.Job = {
    name: `Deploy CDK stacks to ${env} AWS account${deployForBranch ? ' (Branch)' : ''}`,
    runsOn: COMMON_RUNS_ON,
    environment: env,
    permissions: COMMON_WORKFLOW_PERMISSIONS,
    steps: [...commonWorkflowSteps, ...deploymentSteps],
    ...(orderedEnvironments.indexOf(env) > 0 && !deployForBranch
      ? { if: "github.event.workflow_run.conclusion == 'success'" }
      : {}),
  };

  cdkDeploymentWorkflow.addJobs({
    deploy: jobConfig,
  });

  return cdkDeploymentWorkflow;
}

/**
 * Creates a GitHub workflow for destroying the CDK stacks deployed for feature branches.
 *
 * This workflow handles three different destruction scenarios:
 * 1. Manual destruction via workflow_dispatch (uses current branch ref)
 * 2. Automatic destruction when a branch is deleted (extracts branch name from event)
 * 3. Cleanup when pull requests are closed (uses PR head branch)
 *
 * @param gh - An instance of the `github.GitHub` class, used to create the GitHub workflow.
 * @param account - The AWS account ID from which the CDK stacks will be destroyed.
 * @param region - The AWS region from which the CDK stacks will be destroyed.
 * @param env - The environment (e.g., "test", "staging", "production") for which the CDK stacks were deployed.
 * @param githubDeployRole - The name of the GitHub deploy role.
 * @param nodeVersion - The version of Node.js to be used for the destruction.
 * @returns The created `github.GithubWorkflow` instance.
 */
function createCdkDestroyWorkflow(
  gh: github.GitHub,
  account: string,
  region: string,
  env: string,
  githubDeployRole: string,
  nodeVersion: string,
): github.GithubWorkflow {
  const workflowName = `cdk-destroy-${env}-branch`;
  const cdkDestroyWorkflow = new github.GithubWorkflow(gh, workflowName);

  const workflowTriggers = {
    workflowDispatch: {},
    delete: {
      branches: ['**', ...BRANCH_EXCLUSIONS.map((branch) => `!${branch}`)],
    },
  };

  cdkDestroyWorkflow.on(workflowTriggers);

  const commonWorkflowSteps = getCommonWorkflowSteps(nodeVersion, account, region, githubDeployRole);

  const destroySteps = [
    {
      name: 'Fetch Deleted Branch Name',
      id: 'destroy-branch',
      if: "github.event.ref_type == 'branch' && github.event_name == 'delete'",
      run: 'BRANCH=$(cat ${{ github.event_path }} | jq --raw-output \'.ref\'); echo "${{ github.repository }} has ${BRANCH} branch"; echo "DESTROY_BRANCH_NAME=$BRANCH" >> $GITHUB_OUTPUT',
    },
    {
      name: 'Destroy Branch Stack (Workflow Dispatch)',
      if: "github.event_name == 'workflow_dispatch'",
      run: `pnpm run ${getTaskName(env, 'destroy', { isBranch: true, taskType: 'all' })}`,
      env: {
        GIT_BRANCH_REF: '${{ github.ref_name }}',
      },
    },
    {
      name: 'Destroy Branch Stack (Branch Deletion)',
      if: "github.event.ref_type == 'branch' && github.event_name == 'delete'",
      run: `pnpm run ${getTaskName(env, 'destroy', { isBranch: true, taskType: 'all' })}`,
      env: {
        GIT_BRANCH_REF: '${{ steps.destroy-branch.outputs.DESTROY_BRANCH_NAME }}',
      },
    },
  ];

  cdkDestroyWorkflow.addJobs({
    destroy: {
      name: 'Remove deployment of feature branch',
      runsOn: COMMON_RUNS_ON,
      environment: env,
      permissions: COMMON_WORKFLOW_PERMISSIONS,
      steps: [...commonWorkflowSteps, ...destroySteps],
    },
  });

  return cdkDestroyWorkflow;
}

/**
 * Creates a checkout step with optional configuration.
 * @param ref - Optional git ref to checkout.
 * @returns A workflow step for checking out the repository.
 */
function getCheckoutStep(ref?: string): github.workflows.Step {
  return {
    name: 'Checkout repository',
    uses: GITHUB_ACTIONS.checkout,
    // No job built here pushes to git, so keep the token out of .git/config
    with: { 'persist-credentials': false, ...(ref ? { ref } : {}) },
  };
}

/**
 * Creates a pnpm setup step. The pnpm version is resolved from the
 * `packageManager` field in package.json.
 * @returns A workflow step for setting up pnpm.
 */
function getSetupPnpmStep(): github.workflows.Step {
  return {
    name: 'Setup pnpm',
    uses: GITHUB_ACTIONS.setupPnpm,
  };
}

/**
 * Creates a Node.js setup step.
 * @param nodeVersion - The version of Node.js to be used.
 * @returns A workflow step for setting up Node.js.
 */
function getSetupNodeStep(nodeVersion: string): github.workflows.Step {
  return {
    name: 'Setup nodejs environment',
    uses: GITHUB_ACTIONS.setupNode,
    with: {
      'node-version': nodeVersion ? `>=${nodeVersion}` : 'latest',
      cache: 'pnpm',
    },
  };
}

/**
 * Creates an install dependencies step.
 * @returns A workflow step for installing pnpm dependencies.
 */
function getInstallDepsStep(): github.workflows.Step {
  return {
    name: 'Install dependencies',
    run: 'pnpm install --frozen-lockfile',
  };
}

/**
 * Retrieves the common workflow steps for workflows.
 * @param nodeVersion - The version of Node.js to be used.
 * @param account - The AWS account ID (optional, for AWS workflows).
 * @param region - The AWS region (optional, for AWS workflows).
 * @param githubDeployRole - The name of the GitHub deploy role (optional, for AWS workflows).
 * @param checkoutRef - Optional git ref to checkout (e.g., PR SHA).
 * @returns An array of common workflow steps.
 */
function getCommonWorkflowSteps(
  nodeVersion: string,
  account?: string,
  region?: string,
  githubDeployRole?: string,
  checkoutRef?: string,
): github.workflows.Step[] {
  const steps: github.workflows.Step[] = [
    getCheckoutStep(checkoutRef),
    getSetupPnpmStep(),
    getSetupNodeStep(nodeVersion),
  ];

  if (githubDeployRole && region && account) {
    steps.push(getAwsCredentialsStep(account, region, githubDeployRole));
  }

  steps.push(getInstallDepsStep());

  return steps;
}

/**
 * Creates an AWS credentials configuration step.
 * @param account - The AWS account ID.
 * @param region - The AWS region.
 * @param roleName - The name of the AWS role to assume.
 * @returns A workflow step for configuring AWS credentials.
 */
function getAwsCredentialsStep(account: string, region: string, roleName: string): github.workflows.Step {
  return {
    name: 'Configure AWS credentials',
    uses: GITHUB_ACTIONS.configureAwsCredentials,
    with: {
      'role-to-assume': `arn:aws:iam::${account}:role/${roleName}`,
      'aws-region': region,
    },
  };
}
