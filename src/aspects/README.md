# CDK Aspects (Overview)

Purpose
- Reusable CDK Aspects to enforce best practices, catch misconfigurations early, and apply safe defaults across stacks.
- Apply to any scope (`App`, `Stack`, or `Construct`) using `cdk.Aspects`.

Use in your app (example from `src/main.ts`)
```
import * as cdk from 'aws-cdk-lib';
import { BucketEncryptionAspect, BucketPublicAccessAspect, vpcCidrAspect } from './aspects';
import { PermissionBoundary } from './aspects/permission-boundary-aspect';

const app = new cdk.App();

cdk.Aspects.of(app).add(new BucketEncryptionAspect());
cdk.Aspects.of(app).add(new BucketPublicAccessAspect());
cdk.Aspects.of(app).add(new vpcCidrAspect());
cdk.Aspects.of(app).add(new PermissionBoundary('arn:aws:iam::<ACCOUNT_ID>:policy/base-permission-boundary'));
```

Available aspects (brief)
- `BucketEncryptionAspect` – Errors if an S3 bucket has no server‑side encryption configured.
- `BucketPublicAccessAspect` – Warns on public access and auto‑enables all S3 Public Access Block flags on the bucket.
- `vpcCidrAspect` – Errors if a VPC CIDR is outside RFC1918 private ranges.
- `PermissionBoundary` – Overrides IAM Role `PermissionsBoundary` with the provided policy ARN for all roles.

Add a new aspect
- Create `src/aspects/my-aspect.ts` and implement `cdk.IAspect`:
```
import * as cdk from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

export class MyAspect implements cdk.IAspect {
  visit(node: IConstruct): void {
    // inspect or modify node
  }
}
```
- (Optional) export it from `src/aspects/index.ts` for cleaner imports.
- Attach it (app/stack/construct scope):
```
cdk.Aspects.of(app).add(new MyAspect());
```

Notes
- Prefer using Aspects to validate and set safe defaults; avoid heavy runtime mutations that hide configuration intent.
