import { awscdk, JsonFile, TextFile } from 'projen';
import { DependabotScheduleInterval } from 'projen/lib/github';
import { NodePackageManager } from 'projen/lib/javascript';
import { IndentStyle, QuoteStyle, Semicolons, TrailingCommas } from 'projen/lib/javascript/biome/biome-config';
import { createCdkDeploymentWorkflows, createCdkDiffPrWorkflow } from './src/bin/cicd-helper';
import { addCdkActionTask, type Environment, type EnvironmentConfig } from './src/bin/env-helper';

// Set the minimum node version for AWS CDK and the GitHub actions workflow
const nodeVersion = '22.18.0';

/**
 * Define the AWS region for the CDK app and github workflows
 * Default to us-east-1 if AWS_REGION is not set in your environment variables
 */
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
  name: 'aws-cdk-starter-kit',
  description: 'Create and deploy an AWS CDK app on your AWS account in less than 5 minutes using GitHub actions!',
  cdkVersionPinning: true,
  cdkCliVersion: '2.1031.0', // Find the latest CDK version here: https://www.npmjs.com/package/aws-cdk
  cdkVersion: '2.221.0', // Find the latest CDK version here: https://www.npmjs.com/package/aws-cdk-lib
  projenVersion: '0.98.4', // Find the latest projen version here: https://www.npmjs.com/package/projen
  defaultReleaseBranch: 'main',
  packageManager: NodePackageManager.NPM,
  minNodeVersion: nodeVersion,
  projenrcTs: true,
  release: true,
  deps: ['cloudstructs', 'netmask'], // Runtime dependencies of this module
  devDeps: ['@types/netmask'], // Development dependencies of this module
  biome: true,
  context: {
    'cli-telemetry': false, // Disable AWS CDK CLI telemetry, see: https://github.com/aws/aws-cdk/issues/34892
  },
  biomeOptions: {
    biomeConfig: {
      formatter: {
        enabled: true,
        useEditorconfig: true,
        formatWithErrors: false,
        indentStyle: IndentStyle.SPACE,
        indentWidth: 2,
        lineWidth: 120,
      },
      javascript: {
        formatter: {
          jsxQuoteStyle: QuoteStyle.SINGLE,
          quoteStyle: QuoteStyle.SINGLE,
          trailingCommas: TrailingCommas.ALL,
          semicolons: Semicolons.ALWAYS,
        },
      },
      json: {
        parser: {
          allowComments: true,
        },
      },
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
  },
  gitignore: [
    '.DS_Store',
    '.env',
    '.pytest_cache',
    '.venv/',
    '*.js',
    '*.manifest',
    '*.pyc',
    '*.spec',
    '*.zip',
    'coverage/',
    'dist/',
  ],
});

// Create .nvmrc file with the Node.js version (useful for autoswitching node environment locally)
new TextFile(project, '.nvmrc', {
  lines: [`v${nodeVersion}`],
});

// Add VSCode extensions recommendation
new JsonFile(project, '.vscode/extensions.json', {
  obj: {
    recommendations: ['dannysteenman.aws-cdk-extension-pack'],
  },
  marker: false,
});

/**
 * Defines the environment configurations for the CDK application.
 * The order of the environments in this array determines the deployment sequence in the pipeline.
 * Each object in the array should conform to the EnvironmentConfig interface and include the environment name.
 *
 * @example
 * // The 'test' environment will be deployed first, followed by 'production'.
 * const environmentConfigs: (EnvironmentConfig & { name: Environment })[] = [
 *   { name: 'test', accountId: '123456789012', enableBranchDeploy: true },
 *   { name: 'production', accountId: '987654321012', enableBranchDeploy: false },
 * ];
 */
const environmentConfigs: (EnvironmentConfig & { name: Environment })[] = [
  { name: 'test', accountId: '987654321012', enableBranchDeploy: true },
  { name: 'production', accountId: '123456789012', enableBranchDeploy: false },
];

/**
 * Add npm run commands that you can use to deploy to each environment
 * The environment variables are passed to the CDK CLI to deploy to the correct account and region
 * The `cdkDeploymentTask` function is defined in the `src/bin/helper.ts` file
 * You can now run a command like: `npm run dev:synth` to synthesize your aws cdk dev stacks
 */
if (project.github) {
  const orderedEnvironments = environmentConfigs.map((env) => env.name);

  for (const config of environmentConfigs) {
    // Adds customized 'npm run' commands for executing cdk synth, test, deploy and diff for each environment
    addCdkActionTask(project, {
      CDK_DEFAULT_ACCOUNT: config.accountId,
      CDK_DEFAULT_REGION: awsRegion,
      ENVIRONMENT: config.name,
      GITHUB_DEPLOY_ROLE: githubRole,
    });

    // If branch deployment is enabled for this environment, add the GIT_BRANCH_REF task
    if (config.enableBranchDeploy) {
      addCdkActionTask(project, {
        CDK_DEFAULT_ACCOUNT: config.accountId,
        CDK_DEFAULT_REGION: awsRegion,
        ENVIRONMENT: config.name,
        GITHUB_DEPLOY_ROLE: githubRole,
        GIT_BRANCH_REF: `$(echo \${GIT_BRANCH_REF:-$(git rev-parse --abbrev-ref HEAD)})`,
      });
    }

    // Adds GitHub action workflows for deploying the CDK stacks to the target AWS account
    createCdkDeploymentWorkflows(
      project.github,
      config.accountId,
      awsRegion,
      config.name,
      githubRole,
      nodeVersion,
      config.enableBranchDeploy,
      orderedEnvironments,
    );
  }

  // Create CDK diff PR workflow (once, using the highest environment)
  createCdkDiffPrWorkflow(
    project.github,
    environmentConfigs[environmentConfigs.length - 1].accountId, // Uses the account that should be deployed to last (usually production)
    awsRegion,
    githubRole,
    nodeVersion,
    orderedEnvironments,
  );
}

project.synth();
