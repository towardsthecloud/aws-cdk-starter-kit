import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GitHubActionsOidcConstruct } from '../src/constructs';

// Pin the repository identity so the trust policy is asserted against known values instead of
// whichever checkout the tests happen to run in, and so no test shells out to git or the GitHub CLI.
const previousEnvironment = { ...process.env };

beforeEach(() => {
  process.env.GITHUB_REPOSITORY = 'octo-org/octo-repo';
  process.env.GITHUB_REPOSITORY_ID = '456789';
  process.env.GITHUB_REPOSITORY_OWNER_ID = '123456';
  delete process.env.GITHUB_DEPLOY_ROLE;
});

afterEach(() => {
  process.env = { ...previousEnvironment };
});

test('GitHubActionsOidcConstruct creates default GitHub OIDC provider and deployment role', () => {
  const stack = new cdk.Stack();

  new GitHubActionsOidcConstruct(stack, 'GitHubActionsOidc', {
    environment: 'test',
  });

  const template = Template.fromStack(stack);
  template.hasResource('Custom::GitHubOidcProvider', {
    Properties: {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    },
    DeletionPolicy: 'Retain',
  });
  const [provider] = Object.keys(template.findResources('Custom::GitHubOidcProvider'));
  template.hasResource('AWS::IAM::Role', {
    Properties: { RoleName: 'GitHubActionsServiceRole' },
    // The role waits for the provider it trusts.
    DependsOn: Match.arrayWith([provider]),
  });
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'GitHubActionsServiceRole',
    MaxSessionDuration: 7200,
    AssumeRolePolicyDocument: {
      Statement: [
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Principal: {
            Federated: {
              'Fn::Join': [
                '',
                [
                  'arn:',
                  { Ref: 'AWS::Partition' },
                  ':iam::',
                  { Ref: 'AWS::AccountId' },
                  ':oidc-provider/token.actions.githubusercontent.com',
                ],
              ],
            },
          },
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            },
            StringLike: {
              'token.actions.githubusercontent.com:sub': ['repo:octo-org@123456/octo-repo@456789:environment:test'],
            },
          },
        }),
      ],
    },
  });
});

test('GitHubActionsOidcConstruct allows overriding the max session duration', () => {
  const stack = new cdk.Stack();

  new GitHubActionsOidcConstruct(stack, 'GitHubActionsOidc', {
    environment: 'production',
    maxSessionDuration: cdk.Duration.hours(4),
  });

  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Role', {
    MaxSessionDuration: 14400,
  });
});

test('GitHubActionsOidcConstruct trusts additional repositories under the same owner', () => {
  const stack = new cdk.Stack();

  new GitHubActionsOidcConstruct(stack, 'GitHubActionsOidc', {
    environment: 'production',
    additionalRepositories: [{ name: 'example-cdk-app', id: '987654' }],
  });

  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: [
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringLike: {
              'token.actions.githubusercontent.com:sub': [
                'repo:octo-org@123456/octo-repo@456789:environment:production',
                'repo:octo-org@123456/example-cdk-app@987654:environment:production',
              ],
            },
          },
        }),
      ],
    },
  });
});

// A malformed ID would otherwise reach an IAM StringLike condition and widen the trust policy.
test('GitHubActionsOidcConstruct rejects an additional repository without a numeric ID', () => {
  const stack = new cdk.Stack();

  expect(
    () =>
      new GitHubActionsOidcConstruct(stack, 'GitHubActionsOidc', {
        environment: 'production',
        additionalRepositories: [{ name: 'example-cdk-app', id: '*' }],
      }),
  ).toThrow('GitHub repository identity requires a decimal id');
});

test('GitHubActionsOidcConstruct deletes only a provider it created, and only on request', () => {
  const stack = new cdk.Stack();

  new GitHubActionsOidcConstruct(stack, 'GitHubActionsOidc', {
    environment: 'test',
    providerRemovalPolicy: cdk.RemovalPolicy.DESTROY,
  });

  Template.fromStack(stack).hasResource('Custom::GitHubOidcProvider', { DeletionPolicy: 'Delete' });
});

test('GitHubActionsOidcConstruct rejects provider removal policies other than RETAIN and DESTROY', () => {
  const stack = new cdk.Stack();

  new GitHubActionsOidcConstruct(stack, 'GitHubActionsOidc', {
    environment: 'test',
    providerRemovalPolicy: cdk.RemovalPolicy.SNAPSHOT,
  });

  expect(() => Template.fromStack(stack)).toThrow(/providerRemovalPolicy must be either RETAIN or DESTROY/);
});

test('GitHubActionsOidcConstruct lets its handler change only the GitHub provider of its own account', () => {
  const stack = new cdk.Stack();

  new GitHubActionsOidcConstruct(stack, 'GitHubActionsOidc', { environment: 'test' });

  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        {
          Effect: 'Allow',
          Action: [
            'iam:AddClientIDToOpenIDConnectProvider',
            'iam:CreateOpenIDConnectProvider',
            'iam:DeleteOpenIDConnectProvider',
            'iam:GetOpenIDConnectProvider',
            'iam:TagOpenIDConnectProvider',
          ],
          Resource: {
            'Fn::Join': [
              '',
              [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':iam::',
                { Ref: 'AWS::AccountId' },
                ':oidc-provider/token.actions.githubusercontent.com',
              ],
            ],
          },
        },
      ]),
    },
  });
});
