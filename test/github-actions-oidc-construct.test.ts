import { execSync } from 'node:child_process';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GitHubActionsOidcConstruct } from '../src/constructs';

test('GitHubActionsOidcConstruct creates default GitHub OIDC provider and deployment role', () => {
  const previousGithubDeployRole = process.env.GITHUB_DEPLOY_ROLE;
  delete process.env.GITHUB_DEPLOY_ROLE;

  try {
    const stack = new cdk.Stack();

    new GitHubActionsOidcConstruct(stack, 'GitHubActionsOidc', {
      environment: 'test',
    });

    const { gitOwner, gitRepoName } = getGitRepositoryDetails();
    const template = Template.fromStack(stack);
    template.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIDList: ['sts.amazonaws.com'],
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'GitHubActionsServiceRole',
      MaxSessionDuration: 7200,
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [`repo:${gitOwner}/${gitRepoName}:environment:test`],
              },
            },
          }),
        ],
      },
    });
  } finally {
    if (previousGithubDeployRole !== undefined) {
      process.env.GITHUB_DEPLOY_ROLE = previousGithubDeployRole;
    } else {
      delete process.env.GITHUB_DEPLOY_ROLE;
    }
  }
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
    additionalRepositories: ['example-cdk-app'],
  });

  const { gitOwner, gitRepoName } = getGitRepositoryDetails();
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: [
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringLike: {
              'token.actions.githubusercontent.com:sub': [
                `repo:${gitOwner}/${gitRepoName}:environment:production`,
                `repo:${gitOwner}/example-cdk-app:environment:production`,
              ],
            },
          },
        }),
      ],
    },
  });
});

function getGitRepositoryDetails(): { gitOwner: string; gitRepoName: string } {
  const gitRemoteUrl = execSync('git config --get remote.origin.url').toString().trim();
  const match = gitRemoteUrl.match(/(?:git@|https:\/\/)([\w.@:]+)[/:]([\w,.,-]+)\/([\w,.,-]+?)(\.git)?$/);

  if (!match || match.length < 4) {
    throw new Error('Unable to parse Git repository URL');
  }

  const [, , gitOwner, gitRepoName] = match;
  return { gitOwner, gitRepoName };
}
