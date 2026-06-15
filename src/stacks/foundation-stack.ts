import * as cdk from 'aws-cdk-lib';
import { ToolkitCleaner } from 'cloudstructs/lib/toolkit-cleaner';
import type { Construct } from 'constructs';
import { GitHubActionsOidcConstruct } from '../constructs';

/**
 * Optional GitHub Actions OIDC deployment role settings for `FoundationStack`.
 */
export interface FoundationStackGitHubActionsOidcProps {
  /**
   * Additional repository names, under the same GitHub owner, allowed to assume the deployment role.
   *
   * @default - only the repository resolved from the current git remote is trusted
   */
  readonly additionalRepositories?: string[];
  /**
   * Maximum session duration for the GitHub Actions deployment role.
   *
   * @default cdk.Duration.hours(2)
   */
  readonly maxSessionDuration?: cdk.Duration;
  /**
   * Name of the IAM role assumed by GitHub Actions workflows.
   *
   * @default process.env.GITHUB_DEPLOY_ROLE ?? 'GitHubActionsServiceRole'
   */
  readonly roleName?: string;
}

export interface FoundationStackProps extends cdk.StackProps {
  /**
   * Determine the stage to which you want to deploy the stack
   *
   * @default - If not given, it will throw out an error
   */
  readonly environment: string;
  /**
   * Optional GitHub Actions OIDC deployment role settings.
   *
   * The stack always scopes the role trust policy to `environment`, so this accepts every
   * construct prop except `environment`.
   *
   * @default - use the construct defaults
   */
  readonly githubActionsOidc?: FoundationStackGitHubActionsOidcProps;
}

/**
 * FoundationStack
 *
 * This stack sets up fundamental infrastructure components for AWS deployments via GitHub Actions.
 * It includes the creation of an OpenID Connect (OIDC) provider for GitHub and an IAM role for
 * GitHub Actions deployments.
 *
 * @extends cdk.Stack
 *
 * @remarks
 * - Creates a GitHub OIDC provider
 * - Sets up an IAM role for GitHub Actions with necessary permissions
 * - Implements a ToolkitCleaner for managing CDK toolkit resources
 *
 * @param scope - The scope in which to define this construct
 * @param id - The scoped construct ID
 * @param props - Stack properties
 */
export class FoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    ////////////////////////////////
    // Setup GitHub OIDC support //
    //////////////////////////////
    new GitHubActionsOidcConstruct(this, 'GitHubActionsOidc', {
      ...props.githubActionsOidc,
      environment: props.environment,
    });

    ////////////////////////////////
    // Setup CDK Toolkit Cleaner //
    //////////////////////////////
    new ToolkitCleaner(this, 'ToolkitCleaner');
  }
}
