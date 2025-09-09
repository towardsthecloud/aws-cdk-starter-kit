import * as cdk from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

/**
 * Verify that every IAM role has a permission boundary attached
 * If it's not the case, the propery will be automatically overridden by the CDK aspect.
 * Usage example:
 *   cdk.Aspects.of(app).add(
 *     new PermissionBoundary(`arn:aws:iam::${variables.AWS_ACCOUNT_ID}:policy/base-permission-boundary`),
 *   );
 *
 * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-iam-role.html#cfn-iam-role-permissionsboundary
 */
export class PermissionBoundaryAspect implements cdk.IAspect {
  private readonly permissionsBoundaryArn: string;

  constructor(permissionBoundaryArn: string) {
    this.permissionsBoundaryArn = permissionBoundaryArn;
  }

  public visit(node: IConstruct): void {
    if (cdk.CfnResource.isCfnResource(node) && node.cfnResourceType === 'AWS::IAM::Role') {
      node.addPropertyOverride('PermissionsBoundary', this.permissionsBoundaryArn);
    }
  }
}
