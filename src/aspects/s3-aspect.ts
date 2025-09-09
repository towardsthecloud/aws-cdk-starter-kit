import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { IConstruct } from 'constructs';

/**
 * Verify that every S3 bucket server-side encryption enabled
 * If it's not the case, the property will show an error when synthesizing the stack.
 * Usage example:
 *   cdk.Aspects.of(app).add(new BucketEncryptionAspect());
 */
export class BucketEncryptionAspect implements cdk.IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof s3.CfnBucket) {
      if (!node.bucketEncryption) {
        cdk.Annotations.of(node).addError('S3 bucket encryption is not enabled.');
      }
    }
  }
}

/**
 * Verify that every S3 bucket has public access disabled
 * If it's not the case, the property will be automtically overridden
 * by the CDK aspect and will also show a warning when synthesizing the stack.
 * Usage example:
 *   cdk.Aspects.of(app).add(new BucketPublicAccessAspect());
 *
 * @link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-publicaccessblockconfiguration.html
 */
export class BucketPublicAccessAspect implements cdk.IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof s3.CfnBucket) {
      if (
        !node.publicAccessBlockConfiguration ||
        (!cdk.Tokenization.isResolvable(node.publicAccessBlockConfiguration) &&
          node.publicAccessBlockConfiguration.blockPublicAcls !== true)
      ) {
        cdk.Annotations.of(node).addWarning(`S3 bucket: ${node.bucketName} has public access!
        This is not recommended.
        Therefore correcting the publicAccessBlockConfiguration property using Aspects`);
        node.addPropertyOverride('PublicAccessBlockConfiguration', {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        });
      }
    }
  }
}
