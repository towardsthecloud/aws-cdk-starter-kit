import { awscdk } from 'projen';
import { DependabotScheduleInterval } from 'projen/lib/github';
import { NodePackageManager } from 'projen/lib/javascript';
import { createCdkDeploymentWorkflows } from './src/bin/cicd-helper';
import { Environment, EnvironmentConfig, addCdkActionTask } from './src/bin/env-helper';

// Set the minimum node version for AWS CDK and the GitHub actions workflow
const nodeVersion = '20.18.1';

/* Define the AWS region for the CDK app and github workflows
Default to us-east-1 if AWS_REGION is not set in your environment variables */
const awsRegion = process.env.AWS_REGION || 'us-east-1';

/**
 * Define the name of the GitHub deploy role that will be created by the GitHubOIDCStack.
 * Set this as an environment variable for the projen tasks, so other parts of the project
 * can reference the role name.
 * The default role name is 'GitHubActionsServiceRole'.
 */
const githubRole = 'GitHubActionsServiceRole';

/**
 * Creates a new AWS CDK TypeScript application project.
 */
const project = new awscdk.AwsCdkTypeScriptApp({
  authorName: 'Danny Steenman',
  authorUrl: 'https://towardsthecloud.com',
  authorEmail: 'danny@towardsthecloud.com',
  authorOrganization: true,
  name: 'aws-cdk-starterkit',
  description: 'Create and deploy an AWS CDK app on your AWS account in less than 5 minutes using GitHub actions!',
  cdkCliVersion: '2.1016.0', // Find the latest CDK version here: https://www.npmjs.com/package/aws-cdk
  cdkVersion: '2.197.0', // Find the latest CDK version here: https://www.npmjs.com/package/aws-cdk-lib
  cdkVersionPinning: true,
  defaultReleaseBranch: 'main',
  packageManager: NodePackageManager.NPM,
  minNodeVersion: nodeVersion,
  projenVersion: '0.92.6', // Find the latest projen version here: https://www.npmjs.com/package/projen
  projenrcTs: true,
  release: true,
  deps: ['cloudstructs'] /* Runtime dependencies of this module. */,
  prettier: true,
  prettierOptions: {
    settings: {
      jsxSingleQuote: true,
      singleQuote: true,
      printWidth: 120,
    },
  },
  eslintOptions: {
    prettier: true,
    dirs: ['src', 'test'],
    commandOptions: {
      fix: true,
    },
  },
  autoApproveOptions: {
    allowedUsernames: ['dependabot', 'dependabot[bot]', 'github-bot', 'github-actions[bot]'],
    /**
     * The name of the secret that has the GitHub PAT for auto-approving PRs.
     * Generate a new PAT (https://github.com/settings/tokens/new) and add it to your repo's secrets
     */
    secret: 'PROJEN_GITHUB_TOKEN',
  },
  dependabot: true,
  dependabotOptions: {
    scheduleInterval: DependabotScheduleInterval.WEEKLY,
    labels: ['dependencies', 'auto-approve'],
    groups: {
      default: {
        patterns: ['*'],
        excludePatterns: ['aws-cdk*', 'projen'],
      },
    },
    ignore: [{ dependencyName: 'aws-cdk-lib' }, { dependencyName: 'aws-cdk' }],
  },
  githubOptions: {
    mergifyOptions: {
      rules: [
        {
          name: 'Automatic merge for Dependabot pull requests',
          conditions: ['author=dependabot[bot]', 'check-success=build', 'check-success=test'],
          actions: {
            queue: {
              name: 'dependency-updates',
              method: 'squash',
              commit_message_template: '{{title}} (#{{number}})',
            },
          },
        },
      ],
    },
    pullRequestLintOptions: {
      semanticTitleOptions: {
        types: ['feat', 'fix', 'build', 'chore', 'ci', 'docs', 'style', 'refactor'],
      },
    },
  },
  gitignore: [
    '__pycache__',
    '__pycache__/',
    '!.eslintrc.js',
    '.cache',
    '.coverage.*',
    '.coverage',
    '.DS_Store',
    '.env',
    '.mypy_cache',
    '.pytest_cache',
    '.Python',
    '.venv/',
    '.vscode',
    '*.js',
    '*.log',
    '*.manifest',
    '*.pyc',
    '*.spec',
    '*.zip',
    '**/cdk-test-report.xml',
    '*node_modules*',
    'build/',
    'coverage/',
    'dist/',
    'downloads/',
    'env/',
    'ENV/',
    'htmlcov/',
    'sdist/',
    'var/',
    'venv/',
  ],
});

// Configure the environments and their corresponding AWS account IDs
const environmentConfigs: Partial<Record<Environment, EnvironmentConfig>> = {
  test: { accountId: '987654321012', enableBranchDeploy: true },
  production: { accountId: '123456789012', enableBranchDeploy: false },
};

/* Add npm run commands that you can use to deploy to each environment
The environment variables are passed to the CDK CLI to deploy to the correct account and region
The `cdkDeploymentTask` function is defined in the `src/bin/helper.ts` file
You can now run a command like: `npm run dev:synth` to synthesize your aws cdk dev stacks */
if (project.github) {
  for (const [env, config] of Object.entries(environmentConfigs) as [Environment, EnvironmentConfig][]) {
    // Adds customized 'npm run' commands for executing cdk synth, test, deploy and diff for each environment
    addCdkActionTask(project, {
      CDK_DEFAULT_ACCOUNT: config.accountId,
      CDK_DEFAULT_REGION: awsRegion,
      ENVIRONMENT: env,
      GITHUB_DEPLOY_ROLE: githubRole,
    });

    // If branch deployment is enabled for this environment, add the GIT_BRANCH_REF task
    if (config.enableBranchDeploy) {
      addCdkActionTask(project, {
        CDK_DEFAULT_ACCOUNT: config.accountId,
        CDK_DEFAULT_REGION: awsRegion,
        ENVIRONMENT: env,
        GITHUB_DEPLOY_ROLE: githubRole,
        GIT_BRANCH_REF: '$(git rev-parse --abbrev-ref HEAD)',
      });
    }

    // Adds GitHub action workflows for deploying the CDK stacks to the target AWS account
    createCdkDeploymentWorkflows(
      project.github,
      config.accountId,
      awsRegion,
      env,
      githubRole,
      nodeVersion,
      config.enableBranchDeploy,
    );
  }
}

project.synth();
