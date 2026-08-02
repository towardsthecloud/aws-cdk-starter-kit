import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import {
  buildGitHubActionsOidcSubject,
  type GitHubRepositoryReference,
  getGitRepositoryIdentity,
} from '../bin/git-helper';

const GITHUB_DOMAIN = 'token.actions.githubusercontent.com';
const DEFAULT_ROLE_NAME = 'GitHubActionsServiceRole';

/**
 * Properties for `GitHubActionsOidcConstruct`.
 */
export interface GitHubActionsOidcConstructProps {
  /**
   * GitHub environment name that is allowed to assume the deployment role.
   */
  readonly environment: string;
  /**
   * Additional repositories, under the same GitHub owner, allowed to assume the deployment role.
   *
   * Each entry needs the repository name and its numeric GitHub ID, because the trust policy uses
   * GitHub's immutable subject claim. Read the ID with `gh api repos/OWNER/NAME --jq .id`. The ID is
   * checked in rather than resolved during synthesis: a lookup would force every synthesizing CI job
   * to hold a token able to read the other repository. Each repository is trusted only for workflows
   * targeting `environment`.
   *
   * @example
   * additionalRepositories: [{ name: 'my-cdk-app', id: '123456789' }]
   *
   * @default - only the repository resolved from the current git remote is trusted
   */
  readonly additionalRepositories?: GitHubRepositoryReference[];
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

/**
 * Creates a GitHub Actions OIDC provider and IAM deployment role for AWS CDK deployments.
 *
 * The role trusts GitHub's immutable subject claim, `repo:OWNER@OWNER-ID/REPOSITORY@REPOSITORY-ID:CONTEXT`,
 * so renaming, deleting, or transferring a repository cannot hand its trust to a different one. Repositories
 * still emitting legacy subjects must be opted into immutable subjects after this role is deployed; there is
 * no fallback to the legacy subject form.
 */
export class GitHubActionsOidcConstruct extends Construct {
  /** GitHub Actions OIDC identity provider trusted by the deployment role. */
  public readonly provider: iam.OpenIdConnectProvider;

  /** IAM role assumed by GitHub Actions workflows to deploy AWS resources. */
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubActionsOidcConstructProps) {
    super(scope, id);

    const repository = getGitRepositoryIdentity();

    this.provider = new iam.OpenIdConnectProvider(this, 'GithubProvider', {
      url: `https://${GITHUB_DOMAIN}`,
      clientIds: ['sts.amazonaws.com'],
    });

    const context = `environment:${props.environment}`;
    const subjects = [
      buildGitHubActionsOidcSubject(repository, context),
      ...(props.additionalRepositories ?? []).map((additional) =>
        buildGitHubActionsOidcSubject({ ...repository, ...additional }, context),
      ),
    ];
    const conditions: iam.Conditions = {
      StringLike: {
        [`${GITHUB_DOMAIN}:sub`]: subjects,
      },
      StringEquals: {
        [`${GITHUB_DOMAIN}:aud`]: 'sts.amazonaws.com',
      },
    };

    this.role = new iam.Role(this, 'GitHubActionsServiceRole', {
      assumedBy: new iam.WebIdentityPrincipal(this.provider.openIdConnectProviderArn, conditions),
      description: 'This role is used via GitHub Actions to deploy with AWS CDK or Terraform on the target AWS account',
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
      maxSessionDuration: props.maxSessionDuration ?? cdk.Duration.hours(2),
      roleName: props.roleName ?? process.env.GITHUB_DEPLOY_ROLE ?? DEFAULT_ROLE_NAME,
    });
  }
}
