/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: GitHub Actions workflow templates use ${{ }} syntax */
import { github } from 'projen';
import { getTaskName } from './env-helper';

const COMMON_RUNS_ON = ['ubuntu-latest'];
const BRANCH_EXCLUSIONS = ['main', 'hotfix/*', 'github-actions/*', 'dependabot/**'];
/** Standard permissions required for CDK deployment workflows. */
const COMMON_WORKFLOW_PERMISSIONS = {
  actions: github.workflows.JobPermission.WRITE,
  contents: github.workflows.JobPermission.READ,
  idToken: github.workflows.JobPermission.WRITE,
};

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
 */
export function createCdkDeploymentWorkflows(
  gh: github.GitHub,
  account: string,
  region: string,
  env: string,
  githubDeployRole: string,
  nodeVersion: string,
  deployForBranch = false,
) {
  // Always create the regular deployment workflow
  createCdkDeploymentWorkflow(gh, account, region, env, githubDeployRole, nodeVersion, false);

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
): github.GithubWorkflow {
  const workflowName = `cdk-deploy-${env}${deployForBranch ? '-branch' : ''}`;
  // Regular environment deployments are limited to prevent concurrent deployments that could cause conflicts
  // Branch deployments can run in parallel since they're isolated by branch name
  const workflowOptions = !deployForBranch ? { limitConcurrency: true } : undefined;
  const cdkDeploymentWorkflow = new github.GithubWorkflow(gh, workflowName, workflowOptions);

  const workflowTriggers = {
    push: deployForBranch
      ? { branches: ['**', ...BRANCH_EXCLUSIONS.map((branch) => `!${branch}`)] } // All branches except excluded ones
      : env !== 'production'
        ? { branches: ['main'] } // Non-production: trigger on main branch pushes
        : undefined, // Production: manual only (no automatic triggers)
    workflowDispatch: {}, // Always allow manual workflow dispatch
  };

  cdkDeploymentWorkflow.on(workflowTriggers);

  const commonWorkflowSteps = getCommonWorkflowSteps(account, region, githubDeployRole, nodeVersion);

  const deploymentSteps = [
    {
      name: `Run CDK synth for the ${env.toUpperCase()} environment`,
      run: `npm run ${getTaskName(env, 'synth', { isBranch: deployForBranch })}`,
    },
    {
      name: `Deploy CDK to the ${env.toUpperCase()} environment on AWS account ${account}`,
      run: `npm run ${getTaskName(env, 'deploy', { isBranch: deployForBranch, taskType: 'all' })}`,
    },
  ];

  cdkDeploymentWorkflow.addJobs({
    deploy: {
      name: `Deploy CDK stacks to ${env} AWS account${deployForBranch ? ' (Branch)' : ''}`,
      runsOn: COMMON_RUNS_ON,
      environment: env,
      permissions: COMMON_WORKFLOW_PERMISSIONS,
      steps: [...commonWorkflowSteps, ...deploymentSteps],
    },
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

  const commonWorkflowSteps = getCommonWorkflowSteps(account, region, githubDeployRole, nodeVersion);

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
      run: `npm run ${getTaskName(env, 'destroy', { isBranch: true, taskType: 'all' })}`,
      env: {
        GIT_BRANCH_REF: '${{ github.ref_name }}',
      },
    },
    {
      name: 'Destroy Branch Stack (Branch Deletion)',
      if: "github.event.ref_type == 'branch' && github.event_name == 'delete'",
      run: `npm run ${getTaskName(env, 'destroy', { isBranch: true })}`,
      env: {
        GIT_BRANCH_REF: '${{ steps.destroy-branch.outputs.DESTROY_BRANCH_NAME }}',
      },
    },
    {
      name: 'Destroy Branch Stack (Pull Request Closure)',
      if: "github.event_name == 'pull_request'",
      run: `npm run ${getTaskName(env, 'destroy', { isBranch: true, taskType: 'all' })}`,
      env: {
        GIT_BRANCH_REF: '${{ github.head_ref }}',
      },
    },
  ];

  cdkDestroyWorkflow.addJobs({
    destroy: {
      name: 'Remove deployment of feature branch',
      // Run if: not main branch PR, OR branch deletion event, OR manual dispatch
      if: "github.head_ref != 'main' || (github.event.ref_type == 'branch' && github.event_name == 'delete') || github.event_name == 'workflow_dispatch'",
      runsOn: COMMON_RUNS_ON,
      environment: env,
      permissions: COMMON_WORKFLOW_PERMISSIONS,
      steps: [...commonWorkflowSteps, ...destroySteps],
    },
  });

  return cdkDestroyWorkflow;
}

/**
 * Retrieves the common workflow steps for both the deployment and destruction workflows.
 * @param account - The AWS account ID to which the CDK stacks will be deployed/destroyed.
 * @param region - The AWS region to which the CDK stacks will be deployed/destroyed.
 * @param githubDeployRole - The name of the GitHub deploy role.
 * @param nodeVersion - The version of Node.js to be used for the deployment/destruction.
 * @returns An array of common workflow steps.
 */
function getCommonWorkflowSteps(
  account: string | undefined,
  region: string,
  githubDeployRole: string,
  nodeVersion: string | undefined,
): github.workflows.Step[] {
  return [
    {
      name: 'Checkout repository',
      uses: 'actions/checkout@v4',
    },
    {
      name: 'Setup nodejs environment',
      uses: 'actions/setup-node@v4',
      with: {
        'node-version': nodeVersion ? `>=${nodeVersion}` : undefined,
        cache: 'npm',
      },
    },
    {
      name: 'Configure AWS credentials',
      uses: 'aws-actions/configure-aws-credentials@v4',
      with: {
        'role-to-assume': account ? `arn:aws:iam::${account}:role/${githubDeployRole}` : undefined,
        'aws-region': region,
      },
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
  ];
}
