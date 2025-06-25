import { execSync } from 'node:child_process';

/**
 * Retrieves the Git repository details (owner and name) from the current repository.
 * @returns An object containing the Git repository owner and name.
 */
export function getGitRepositoryDetails(): { gitOwner: string; gitRepoName: string } {
  const gitRemoteUrl = getGitRemoteUrl();
  const { gitOwner, gitRepoName } = parseGitRemoteUrl(gitRemoteUrl);

  if (!gitOwner || !gitRepoName) {
    throw new Error('Unable to parse Git repository URL');
  }

  return { gitOwner, gitRepoName };
}

/**
 * Retrieves the Git remote URL for the current repository.
 * @returns The Git remote URL.
 */
function getGitRemoteUrl(): string {
  return execSync('git config --get remote.origin.url').toString().trim();
}

/**
 * Parses the Git remote URL and extracts the repository owner and name.
 * @param gitRemoteUrl - The Git remote URL.
 * @returns An object containing the Git repository owner and name.
 */
function parseGitRemoteUrl(gitRemoteUrl: string): { gitOwner: string | undefined; gitRepoName: string | undefined } {
  const urlPattern = /(?:git@|https:\/\/)([\w.@:]+)[/:]([\w,.,-]+)\/([\w,.,-]+?)(\.git)?$/;
  const match = gitRemoteUrl.match(urlPattern);

  if (!match || match.length < 4) {
    return { gitOwner: undefined, gitRepoName: undefined };
  }

  const [, , owner, repoName] = match;
  return { gitOwner: owner, gitRepoName: repoName };
}
