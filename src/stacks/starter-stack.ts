import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
// import { NetworkConstruct } from '../constructs';

export interface StarterStackProps extends cdk.StackProps {
  /**
   * Determine the stage to which you want to deploy the stack
   *
   * @default - If not given, it will throw out an error
   */
  readonly environment?: string;
}

/**
 * StarterStack
 *
 * This stack serves as the starting point for building your AWS infrastructure using CDK.
 * It provides a foundation for adding and organizing your AWS resources and constructs.
 *
 * @extends cdk.Stack
 *
 * @remarks
 * - Use this stack to begin defining your infrastructure components
 * - Add new constructs and resources within the constructor of this class
 * - Customize and extend this stack based on your specific infrastructure needs
 *
 * @example
 * To add a new S3 bucket:
 * ```
 * import * as s3 from 'aws-cdk-lib/aws-s3';
 *
 * // In the constructor:
 * new s3.Bucket(this, 'MyBucket', {
 *   bucketName: 'my-unique-bucket-name',
 *   versioned: true,
 *   encryption: s3.BucketEncryption.S3_MANAGED,
 * });
 * ```
 *
 * @param scope - The scope in which to define this construct
 * @param id - The scoped construct ID
 * @param props - Stack properties including the deployment environment
 */
export class StarterStack extends cdk.Stack {
  // biome-ignore lint/complexity/noUselessConstructor: Constructor needed for proper props typing
  constructor(scope: Construct, id: string, props: StarterStackProps) {
    super(scope, id, props);

    // ↓↓ Add your constructs and resources below ↓↓

    // Sample construct that creates a secure VPC
    // new NetworkConstruct(this, 'NetworkConstruct');

    // TODO: Add your own constructs and resources here
    // For example:
    // - S3 buckets
    // - Lambda functions
    // - DynamoDB tables
    // - API Gateway
    // - etc.

    // Remember to import necessary modules at the top of the file
    // and to organize your constructs logically within this stack
    // or create additional stacks for different components of your infrastructure.
  }
}
