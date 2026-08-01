import { execFileSync, execSync } from 'node:child_process';
import { buildGitHubActionsOidcSubject, getGitRepositoryIdentity } from '../src/bin/git-helper';

jest.mock('node:child_process', () => ({
  execFileSync: jest.fn(),
  execSync: jest.fn(),
}));

const mockedExecFileSync = jest.mocked(execFileSync);
const mockedExecSync = jest.mocked(execSync);

afterEach(() => {
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY_ID;
  delete process.env.GITHUB_REPOSITORY_OWNER_ID;
});

test('getGitRepositoryIdentity uses GitHub Actions repository metadata without invoking gh', () => {
  process.env.GITHUB_REPOSITORY = 'octo-org/octo-repo';
  process.env.GITHUB_REPOSITORY_ID = '456789';
  process.env.GITHUB_REPOSITORY_OWNER_ID = '123456';

  expect(getGitRepositoryIdentity()).toEqual({
    owner: 'octo-org',
    ownerId: '123456',
    name: 'octo-repo',
    id: '456789',
  });
  expect(mockedExecFileSync).not.toHaveBeenCalled();
  expect(mockedExecSync).not.toHaveBeenCalled();
});

test('getGitRepositoryIdentity resolves a normal git checkout through gh', () => {
  mockedExecSync.mockReturnValue('git@github.com:octo-org/octo-repo.git');
  mockedExecFileSync.mockReturnValue(
    JSON.stringify({
      owner: 'octo-org',
      ownerId: '123456',
      name: 'octo-repo',
      id: '456789',
    }),
  );

  expect(getGitRepositoryIdentity()).toEqual({
    owner: 'octo-org',
    ownerId: '123456',
    name: 'octo-repo',
    id: '456789',
  });
  expect(mockedExecFileSync).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', 'repos/octo-org/octo-repo']), {
    encoding: 'utf8',
  });
});

test('getGitRepositoryIdentity explains how to authenticate when gh cannot resolve the identity', () => {
  mockedExecSync.mockReturnValue('git@github.com:octo-org/octo-repo.git');
  mockedExecFileSync.mockImplementation(() => {
    throw new Error('gh: command not found');
  });

  expect(() => getGitRepositoryIdentity()).toThrow('gh auth login');
});

const repository = {
  owner: 'octo-org',
  ownerId: '123456',
  name: 'octo-repo',
  id: '456789',
};

test('buildGitHubActionsOidcSubject renders the immutable repository subject', () => {
  expect(buildGitHubActionsOidcSubject(repository, 'environment:production')).toBe(
    'repo:octo-org@123456/octo-repo@456789:environment:production',
  );
});

// The subject lands in an IAM StringLike condition, so a wildcard that slips
// through widens the trust policy rather than merely failing.
test.each(['ownerId', 'id'] as const)('buildGitHubActionsOidcSubject rejects a non-decimal %s', (field) => {
  for (const value of ['', '*', '12*', 'abc']) {
    expect(() => buildGitHubActionsOidcSubject({ ...repository, [field]: value }, 'environment:production')).toThrow(
      `GitHub repository identity requires a decimal ${field}`,
    );
  }
});

test.each(['owner', 'name'] as const)('buildGitHubActionsOidcSubject rejects a wildcard %s', (field) => {
  for (const value of ['', '*', 'octo*', 'octo/repo']) {
    expect(() => buildGitHubActionsOidcSubject({ ...repository, [field]: value }, 'environment:production')).toThrow(
      `GitHub repository identity requires a ${field} of letters`,
    );
  }
});

test('buildGitHubActionsOidcSubject rejects a wildcard inside a context', () => {
  expect(() => buildGitHubActionsOidcSubject(repository, 'environment:prod*')).toThrow('must not contain a wildcard');
  expect(buildGitHubActionsOidcSubject(repository, '*')).toBe('repo:octo-org@123456/octo-repo@456789:*');
});
