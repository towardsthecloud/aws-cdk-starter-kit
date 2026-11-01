import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import {
  buildGitHubActionsOidcSubject,
  type GitHubRepositoryReference,
  getGitRepositoryIdentity,
} from '../bin/git-helper';

const GITHUB_DOMAIN = 'token.actions.githubusercontent.com';
const GITHUB_AUDIENCE = 'sts.amazonaws.com';
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
  /**
   * What happens to a GitHub OIDC provider this construct created when the stack is deleted. `DESTROY` deletes it;
   * `RETAIN` keeps it, and deploying again adopts it. A provider the construct adopted always stays.
   *
   * @default cdk.RemovalPolicy.RETAIN
   */
  readonly providerRemovalPolicy?: cdk.RemovalPolicy;
}

/**
 * Creates a GitHub Actions OIDC provider and IAM deployment role for AWS CDK deployments.
 *
 * IAM allows one GitHub OIDC provider per account, and the account may already have one, for example from a landing
 * zone or an earlier setup. A custom resource therefore adopts an existing provider, adding the `sts.amazonaws.com`
 * audience if it is missing, and creates one only when the account has none. It deletes only a provider it created,
 * which it tags `aws-cdk-starter-kit:github-oidc-provider=created`, and only under `providerRemovalPolicy: DESTROY`.
 *
 * The role trusts GitHub's immutable subject claim, `repo:OWNER@OWNER-ID/REPOSITORY@REPOSITORY-ID:CONTEXT`,
 * so renaming, deleting, or transferring a repository cannot hand its trust to a different one. Repositories
 * still emitting legacy subjects must be opted into immutable subjects after this role is deployed; there is
 * no fallback to the legacy subject form.
 */
export class GitHubActionsOidcConstruct extends Construct {
  /** GitHub Actions OIDC identity provider trusted by the deployment role. */
  public readonly provider: iam.IOpenIdConnectProvider;

  /** IAM role assumed by GitHub Actions workflows to deploy AWS resources. */
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubActionsOidcConstructProps) {
    super(scope, id);

    const repository = getGitRepositoryIdentity();

    const providerRemovalPolicy = props.providerRemovalPolicy ?? cdk.RemovalPolicy.RETAIN;
    this.node.addValidation({
      validate: () =>
        providerRemovalPolicy === cdk.RemovalPolicy.RETAIN || providerRemovalPolicy === cdk.RemovalPolicy.DESTROY
          ? []
          : ['providerRemovalPolicy must be either RETAIN or DESTROY'],
    });
    const providerArn = cdk.Stack.of(this).formatArn({
      service: 'iam',
      region: '',
      resource: 'oidc-provider',
      resourceName: GITHUB_DOMAIN,
    });
    const providerResource = this.createProviderResource(providerArn);
    providerResource.applyRemovalPolicy(providerRemovalPolicy);
    // The custom resource returns the provider ARN, so the role that trusts it waits for the provider.
    this.provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GithubProvider',
      providerResource.ref,
    );

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
        [`${GITHUB_DOMAIN}:aud`]: GITHUB_AUDIENCE,
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

  /** A log group that the stack deletes, so no function logs to Lambda's implicit one, which outlives the stack. */
  private createLogGroup(id: string): logs.LogGroup {
    return new logs.LogGroup(this, id, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  /** The custom resource that creates the account's GitHub provider or adopts the one it has. */
  private createProviderResource(providerArn: string): cdk.CustomResource {
    const handler = new lambda.Function(this, 'ProviderHandler', {
      runtime: lambda.Runtime.PYTHON_3_14,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.on_event',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'assets', 'lambda', 'github-oidc-provider')),
      description: "Creates or adopts the account's GitHub Actions OIDC provider",
      timeout: cdk.Duration.minutes(1),
      logGroup: this.createLogGroup('ProviderHandlerLogs'),
    });
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'iam:AddClientIDToOpenIDConnectProvider',
          'iam:CreateOpenIDConnectProvider',
          'iam:DeleteOpenIDConnectProvider',
          'iam:GetOpenIDConnectProvider',
          'iam:TagOpenIDConnectProvider',
        ],
        resources: [providerArn],
      }),
    );
    const provider = new cr.Provider(this, 'ProviderFramework', {
      onEventHandler: handler,
      logGroup: this.createLogGroup('ProviderFrameworkLogs'),
    });
    return new cdk.CustomResource(this, 'Provider', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::GitHubOidcProvider',
      properties: {
        url: `https://${GITHUB_DOMAIN}`,
        clientIds: [GITHUB_AUDIENCE],
      },
    });
  }
}
