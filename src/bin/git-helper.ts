import { execFileSync, execSync } from 'node:child_process';

/**
 * Immutable GitHub repository metadata used in an Actions OIDC subject.
 *
 * GitHub's immutable subject claim identifies a repository by numeric ID as well as by name,
 * so a repository that is renamed, deleted and recreated, or transferred cannot silently
 * inherit a trust policy written for the old one.
 */
export interface GitHubRepositoryIdentity {
  /** GitHub account or organization that owns the repository, for example `towardsthecloud`. */
  readonly owner: string;
  /** Numeric GitHub ID of the owner, as a decimal string. */
  readonly ownerId: string;
  /** Repository name, for example `aws-cdk-starter-kit`. */
  readonly name: string;
  /** Numeric GitHub ID of the repository, as a decimal string. */
  readonly id: string;
}

/**
 * A repository other than the one being synthesized that is allowed to assume the deployment role.
 *
 * The numeric ID is checked in rather than looked up, because a lookup would force every
 * synthesizing CI job to hold a token able to read the other repository. Obtain it with
 * `gh api repos/OWNER/NAME --jq .id`.
 */
export interface GitHubRepositoryReference {
  /** Repository name under the same owner, for example `my-cdk-app`. */
  readonly name: string;
  /** Numeric GitHub ID of the repository, as a decimal string. */
  readonly id: string;
}

/**
 * These subjects land in an IAM `StringLike` condition, so an unvalidated value
 * is a trust-boundary defect rather than a cosmetic one: an `id` of `*` would
 * widen the policy to every repository sharing that name. Constrain each field
 * to what GitHub can actually issue, which leaves no room for a wildcard.
 */
const NUMERIC_ID_PATTERN = /^[0-9]+$/;
const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Builds an immutable GitHub Actions OIDC subject for a repository and workflow context.
 *
 * @example
 * buildGitHubActionsOidcSubject(repository, 'environment:production');
 * // 'repo:octo-org@123456/octo-repo@456789:environment:production'
 *
 * @param repository - Immutable identity of the repository to trust.
 * @param context - Subject context after the repository segment, such as `environment:production` or `*`.
 * @returns The immutable GitHub Actions OIDC subject claim.
 * @throws If any identity field is malformed, or the context carries an unintended wildcard.
 */
export function buildGitHubActionsOidcSubject(repository: GitHubRepositoryIdentity, context: string): string {
  for (const field of ['ownerId', 'id'] as const) {
    if (!NUMERIC_ID_PATTERN.test(repository[field])) {
      throw new Error(`GitHub repository identity requires a decimal ${field}, got "${repository[field]}"`);
    }
  }

  for (const field of ['owner', 'name'] as const) {
    if (!REPOSITORY_NAME_PATTERN.test(repository[field])) {
      throw new Error(
        `GitHub repository identity requires a ${field} of letters, digits, '.', '_', or '-', ` +
          `got "${repository[field]}"`,
      );
    }
  }

  if (context !== '*' && /[*?]/.test(context)) {
    throw new Error(`GitHub Actions OIDC subject context must not contain a wildcard, got "${context}"`);
  }

  return `repo:${repository.owner}@${repository.ownerId}/${repository.name}@${repository.id}:${context}`;
}

/**
 * Resolves the immutable identity of the repository being synthesized.
 *
 * In GitHub Actions this reads the default `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_ID`, and
 * `GITHUB_REPOSITORY_OWNER_ID` variables, so no workflow needs a GitHub token. Locally it reads
 * the owner and name from the `origin` remote and fetches the numeric IDs with the GitHub CLI.
 *
 * @returns The immutable identity of the current repository.
 * @throws If the `origin` remote cannot be parsed, or the GitHub CLI cannot resolve the IDs.
 */
export function getGitRepositoryIdentity(): GitHubRepositoryIdentity {
  const repository = process.env.GITHUB_REPOSITORY?.split('/');
  const id = process.env.GITHUB_REPOSITORY_ID;
  const ownerId = process.env.GITHUB_REPOSITORY_OWNER_ID;

  if (repository?.length === 2 && id && ownerId) {
    const [owner, name] = repository;
    return { owner, ownerId, name, id };
  }

  const remoteUrl = execSync('git config --get remote.origin.url').toString().trim();
  const match = remoteUrl.match(/(?:git@|https:\/\/)([\w.@:]+)[/:]([\w,.,-]+)\/([\w,.,-]+?)(\.git)?$/);
  if (!match) {
    throw new Error('Unable to parse Git repository URL');
  }

  const [, , owner, name] = match;

  try {
    return JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          `repos/${owner}/${name}`,
          '--jq',
          '{owner: .owner.login, ownerId: (.owner.id | tostring), name: .name, id: (.id | tostring)}',
        ],
        { encoding: 'utf8' },
      ),
    ) as GitHubRepositoryIdentity;
  } catch {
    throw new Error(
      `Unable to resolve immutable GitHub identity for ${owner}/${name}. Install the GitHub CLI and authenticate with "gh auth login" or GH_TOKEN.`,
    );
  }
}
