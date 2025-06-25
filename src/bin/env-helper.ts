import type { awscdk } from 'projen';

/** Represents the possible deployment environments. */
export type Environment = 'sandbox' | 'development' | 'test' | 'staging' | 'production';

/** Supported CDK actions for task generation. */
export const SUPPORTED_CDK_ACTIONS = ['synth', 'diff', 'deploy', 'destroy', 'ls'] as const;

/** Configuration settings for a specific environment. */
export interface EnvironmentConfig {
  /** The unique identifier for the account. */
  accountId: string;
  /** Flag to enable or disable branch deployments. */
  enableBranchDeploy: boolean;
}

/**
 * Generates a task name following the consistent naming convention.
 *
 * @param environment - The environment name (e.g., 'development', 'production').
 * @param action - The CDK action (e.g., 'synth', 'deploy', 'destroy').
 * @param options - Additional options for task naming.
 * @returns The formatted task name.
 *
 * @example
 * // Regular environment task
 * getTaskName('development', 'synth') // Returns: "development:synth"
 *
 * @example
 * // Branch deployment task with all stacks
 * getTaskName('staging', 'deploy', { isBranch: true, taskType: 'all' }) // Returns: "staging:branch:deploy:all"
 *
 * @example
 * // Branch deployment task for specific stack
 * getTaskName('staging', 'deploy', { isBranch: true, taskType: 'stack' }) // Returns: "staging:branch:deploy:stack"
 */
export function getTaskName(
  environment: string,
  action: string,
  options: {
    isBranch?: boolean;
    taskType?: 'all' | 'stack';
  } = {},
): string {
  const { isBranch = false, taskType } = options;

  let taskName = isBranch ? `${environment}:branch:${action}` : `${environment}:${action}`;

  // Add task type suffix for actions that support it (not synth or ls)
  if (taskType && action !== 'synth' && action !== 'ls') {
    taskName += `:${taskType}`;
  }

  return taskName;
}

/**
 * Adds customized 'npm run' commands for executing AWS CDK actions (synth, diff, deploy, destroy, ls)
 * for a specific environment and branch (if applicable).
 *
 * Creates different task variants:
 * - For synth/ls: Single task that operates on all stacks
 * - For deploy/destroy/diff: Two variants (:all for all stacks, :stack for specific stacks)
 * - Branch deployments get "branch" in the task name when GIT_BRANCH_REF is present
 *
 * @param cdkProject - The `AwsCdkTypeScriptApp` instance.
 * @param targetAccount - An object containing the environment-specific configuration,
 * including the AWS account ID, environment name, and optional GIT_BRANCH_REF.
 */
export function addCdkActionTask(cdkProject: awscdk.AwsCdkTypeScriptApp, targetAccount: { [name: string]: string }) {
  for (const action of SUPPORTED_CDK_ACTIONS) {
    const isBranch = !!targetAccount.GIT_BRANCH_REF;
    const baseTaskName = getTaskName(targetAccount.ENVIRONMENT, action, { isBranch });

    let execCommand: string;

    switch (action) {
      case 'synth':
        execCommand = 'cdk synth';
        break;
      case 'destroy':
        execCommand = 'cdk destroy --force';
        break;
      case 'deploy':
        execCommand = 'cdk deploy --require-approval never';
        break;
      case 'diff':
        execCommand = 'cdk diff';
        break;
      case 'ls':
        execCommand = 'cdk ls';
        break;
      default:
        execCommand = `cdk ${action} --require-approval never`;
    }

    // Actions that operate on all stacks by default - create single task
    if (action === 'synth' || action === 'ls') {
      const taskDescription = `${
        action.charAt(0).toUpperCase() + action.slice(1)
      } the stacks on the ${targetAccount.ENVIRONMENT.toUpperCase()} account`;

      cdkProject.addTask(baseTaskName, {
        description: taskDescription,
        env: targetAccount,
        exec: execCommand,
      });
    } else {
      // Actions that can target specific stacks - create both :all and :stack variants
      // Task for all stacks
      const allTaskName = getTaskName(targetAccount.ENVIRONMENT, action, { isBranch, taskType: 'all' });
      const allTaskDescription = `${
        action.charAt(0).toUpperCase() + action.slice(1)
      } all stacks on the ${targetAccount.ENVIRONMENT.toUpperCase()} account`;

      cdkProject.addTask(allTaskName, {
        description: allTaskDescription,
        env: targetAccount,
        exec: `${execCommand} --all`,
      });

      // Task for single stacks (with receiveArgs)
      const stackTaskName = getTaskName(targetAccount.ENVIRONMENT, action, { isBranch, taskType: 'stack' });
      const stackTaskDescription = `${
        action.charAt(0).toUpperCase() + action.slice(1)
      } specific stack(s) on the ${targetAccount.ENVIRONMENT.toUpperCase()} account`;

      cdkProject.addTask(stackTaskName, {
        description: stackTaskDescription,
        env: targetAccount,
        exec: execCommand,
        receiveArgs: true,
      });
    }
  }
}

/**
 * Extracts the branch name from the Git branch reference, excluding certain branches.
 * The extracted branch name is cleaned and truncated to a maximum of 25 characters.
 * @param gitBranchRef - The Git branch reference.
 * @returns The cleaned and truncated branch name, or `undefined` if the branch should be excluded.
 */
export function extractCleanedBranchName(gitBranchRef: string | undefined): string | undefined {
  if (!gitBranchRef) {
    return undefined;
  }

  const gitTagRegex = /v\d+\.\d+\.\d+$/;
  if (gitTagRegex.test(gitBranchRef)) {
    return undefined;
  }

  const lowerCaseBranchName = gitBranchRef.toLowerCase();
  const parts = lowerCaseBranchName.split('/');
  const lastPart = parts[parts.length - 1];

  // Exclude main and development branches from the branch-based naming
  if (lastPart === 'main' || lastPart === 'develop' || lastPart === 'development') {
    return undefined;
  }

  // Filter out all characters except a-Z and hyphen
  const branchNameWithoutSpecialCharacters = lastPart.replace(/[^a-zA-Z0-9-]/g, '').replace(/-+$/, '');
  // Limit to 25 characters
  return branchNameWithoutSpecialCharacters.substring(0, 25);
}

/**
 * Creates an environment-aware resource name with a branch or environment suffix.
 * The name is truncated to a maximum of 64 characters to comply with AWS naming constraints.
 *
 * @param baseName - The base name for the resource.
 * @returns A resource name with an environment or branch suffix.
 * @throws Error if GIT_BRANCH_REF is "main".
 */
export function createEnvResourceName(baseName: string): string {
  const branchName = process.env.GIT_BRANCH_REF;
  const environment = process.env.ENVIRONMENT || 'dev';

  if (branchName && branchName.toLowerCase() === 'main') {
    throw new Error('Invalid branch-based deployment: GIT_BRANCH_REF cannot be "main"');
  }

  let resourceName: string;

  if (branchName) {
    const cleanedBranchName = extractCleanedBranchName(branchName);
    resourceName = `${baseName}-${cleanedBranchName}`;
  } else {
    resourceName = `${baseName}-${environment}`;
  }

  if (resourceName.length <= 64) {
    return resourceName;
  }

  // Truncate the resource name to 64 characters, preserving alphanumeric characters at the end
  return resourceName.slice(0, 64).replace(/[^a-zA-Z0-9]+$/, '');
}
