import { awscdk, type github } from 'projen';
import {
  createCdkDeploymentWorkflows,
  createCdkValidateWorkflow,
  dockerCacheRestoreSteps,
} from '../src/bin/cicd-helper';

test('offline validation checks each configured environment in an isolated assembly and waits for all checks', () => {
  const project = new awscdk.AwsCdkTypeScriptApp({
    name: 'fixture',
    defaultReleaseBranch: 'main',
    cdkVersion: '2.271.0',
  });
  if (!project.github) throw new Error('Expected GitHub integration');
  const workflow = createCdkValidateWorkflow(project.github, '24.21.0', ['test', 'production']);
  const steps = (workflow.getJob('validate') as github.workflows.Job).steps;
  const checks = steps.filter((step) => step.background);
  expect(checks.map((step) => step.run)).toEqual([
    'pnpm run test:validate --no-online --output cdk.out/test',
    'pnpm run production:validate --no-online --output cdk.out/production',
  ]);
  expect(new Set(checks.map((step) => step.id)).size).toBe(2);
  expect(steps.find((step) => step.wait)?.wait).toEqual(checks.map((step) => step.id));
  expect(checks.every((step) => !step.continueOnError)).toBe(true);
});

test('AWS validation and deploy wait for authentication after dependency installation', () => {
  const project = new awscdk.AwsCdkTypeScriptApp({
    name: 'fixture',
    defaultReleaseBranch: 'main',
    cdkVersion: '2.271.0',
  });
  if (!project.github) throw new Error('Expected GitHub integration');
  createCdkDeploymentWorkflows(project.github, '123456789012', 'us-east-1', 'test', 'DeployRole', '24.21.0', false, [
    'test',
  ]);
  const workflow = project.github.tryFindWorkflow('cdk-deploy-test');
  if (!workflow) throw new Error('Expected deployment workflow');
  const steps = (workflow.getJob('deploy') as github.workflows.Job).steps;
  const auth = steps.findIndex((step) => step.id === 'configure_aws_credentials');
  const install = steps.findIndex((step) => step.name === 'Install dependencies');
  const wait = steps.findIndex((step) => step.wait?.includes('configure_aws_credentials'));
  const validate = steps.findIndex((step) => step.run?.includes('test:validate'));
  expect(steps[auth]?.background).toBe(true);
  expect(auth).toBeLessThan(install);
  expect(install).toBeLessThan(wait);
  expect(wait).toBeLessThan(validate);
});

test('build and environment validation cannot overwrite each other’s immutable Docker cache', () => {
  const build = dockerCacheRestoreSteps('build').find((step) => step.id === 'docker_cache')?.with;
  const validation = dockerCacheRestoreSteps('validate').find((step) => step.id === 'docker_cache')?.with;
  expect(build?.key).toBeDefined();
  expect(validation?.key).toBeDefined();
  expect(build?.key).not.toEqual(validation?.key);
  expect(build?.['restore-keys']).not.toEqual(validation?.['restore-keys']);
});
