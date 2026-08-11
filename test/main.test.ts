import { App, Validations } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StarterStack } from '../src/stacks';

test('Snapshot', () => {
  const app = new App();
  const stack = new StarterStack(app, 'test', {});
  Validations.of(stack).acknowledge({
    id: 'CloudFormation-Validate::F0001',
    reason: 'StarterStack is intentionally empty until users add their infrastructure',
  });

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});
