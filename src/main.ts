import * as cdk from 'aws-cdk-lib';
import { createEnvResourceName } from './bin/env-helper';
import { FoundationStack, StarterStack } from './stacks';

// Inherit environment variables from npm run commands (displayed in .projen/tasks.json)
const environment = process.env.ENVIRONMENT || 'dev';
const awsAccountConfig = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Instantiate the CDK app
const app = new cdk.App();

/**
 * Conditional deployment of the FoundationStack.
 *
 * This section of code is responsible for deploying the FoundationStack, which sets up
 * crucial infrastructure components like GitHub OpenID Connect (OIDC) support and IAM roles
 * for GitHub Actions deployments.
 *
 * @remarks
 * - This stack should be deployed only once per AWS account.
 * - It should not be part of branch-based deployments.
 * - The deployment is conditional, based on the absence of the GIT_BRANCH_REF environment variable.
 */
if (!process.env.GIT_BRANCH_REF) {
  new FoundationStack(app, createEnvResourceName('FoundationStack'), {
    env: awsAccountConfig,
    environment: environment,
  });
}

// Create a new stack with your resources
new StarterStack(app, createEnvResourceName('StarterStack'), {
  env: awsAccountConfig,
  environment: environment,
});

// Tag all resources in CloudFormation with the environment name
cdk.Tags.of(app).add('environment', `${environment}`);
// Tag branch based deploys with the branch name to easily identify the branch in the AWS console
process.env.GIT_BRANCH_REF ? cdk.Tags.of(app).add('branch', createEnvResourceName('b')) : null;

app.synth();
