import { execSync } from 'node:child_process';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

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
   * Additional repository names, under the same GitHub owner, allowed to assume the deployment role.
   *
   * Provide bare repository names, for example `my-cdk-app`. The GitHub owner is resolved from
   * the current git remote. Each repository is trusted only for workflows targeting `environment`.
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

/**
 * Creates a GitHub Actions OIDC provider and IAM deployment role for AWS CDK deployments.
 */
export class GitHubActionsOidcConstruct extends Construct {
  /** GitHub Actions OIDC identity provider trusted by the deployment role. */
  public readonly provider: iam.OpenIdConnectProvider;

  /** IAM role assumed by GitHub Actions workflows to deploy AWS resources. */
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubActionsOidcConstructProps) {
    super(scope, id);

    const { gitOwner, gitRepoName } = getGitRepositoryDetails();

    this.provider = new iam.OpenIdConnectProvider(this, 'GithubProvider', {
      url: `https://${GITHUB_DOMAIN}`,
      clientIds: ['sts.amazonaws.com'],
    });

    const repositories = [gitRepoName, ...(props.additionalRepositories ?? [])];
    const subjects = repositories.map(
      (repository) => `repo:${gitOwner}/${repository}:environment:${props.environment}`,
    );
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

/**
 * Retrieves the Git repository details from the current repository remote.
 */
function getGitRepositoryDetails(): { gitOwner: string; gitRepoName: string } {
  const gitRemoteUrl = getGitRemoteUrl();
  const { gitOwner, gitRepoName } = parseGitRemoteUrl(gitRemoteUrl);

  if (!gitOwner || !gitRepoName) {
    throw new Error('Unable to parse Git repository URL');
  }

  return { gitOwner, gitRepoName };
}

function getGitRemoteUrl(): string {
  return execSync('git config --get remote.origin.url').toString().trim();
}

function parseGitRemoteUrl(gitRemoteUrl: string): { gitOwner: string | undefined; gitRepoName: string | undefined } {
  const urlPattern = /(?:git@|https:\/\/)([\w.@:]+)[/:]([\w,.,-]+)\/([\w,.,-]+?)(\.git)?$/;
  const match = gitRemoteUrl.match(urlPattern);

  if (!match || match.length < 4) {
    return { gitOwner: undefined, gitRepoName: undefined };
  }

  const [, , owner, repoName] = match;
  return { gitOwner: owner, gitRepoName: repoName };
}
