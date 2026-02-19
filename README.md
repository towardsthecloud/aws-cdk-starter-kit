# [![AWS CDK Starter Kit header](./images/github-title-banner.png)](https://towardsthecloud.com)

# AWS CDK Starter Kit

[![Build Status](https://github.com/towardsthecloud/aws-cdk-starter-kit/actions/workflows/build.yml/badge.svg)](https://github.com/towardsthecloud/aws-cdk-starter-kit/actions/workflows/build.yml)
[![Biome Code Formatting](https://img.shields.io/badge/code_style-biome-brightgreen.svg)](https://biomejs.dev)
[![Latest release](https://img.shields.io/github/release/towardsthecloud/aws-cdk-starter-kit.svg)](https://github.com/towardsthecloud/aws-cdk-starter-kit/releases)

Production-ready AWS CDK TypeScript starter kit with secure OIDC authentication, automated CI/CD, and branch-based deployments. Deploy infrastructure to AWS in minutes with projen-powered configuration.

## 🚀 Features

- **⚡ Rapid Setup**: Jumpstart your project within minutes by tweaking a [single configuration file (projen)](./.projenrc.ts)
  - Preconfigured TypeScript with optimized compiler settings in [tsconfig.json](./tsconfig.json)
  - Pre-configured linting & formatting with [biome.jsonc](./biome.jsonc) for code quality
  - Clean [project structure](#project-structure) for easy management of constructs and stacks
- **🛡️ Seamless Security**: OIDC authentication for keyless AWS deployments - no stored credentials or long-lived secrets required
- **🤖 Automated CI/CD**: Out-of-the-box GitHub Actions workflows with multi-account support for enterprise-ready deployments
- **💬 Automated CDK Diff on PRs**: [CDK diff outputs](https://github.com/marketplace/actions/aws-cdk-diff-pr-commenter) are automatically posted to your pull requests for easy infrastructure change reviews
- **💻 Branch-based Deployments**: Deploy multiple CDK stacks to the same AWS environments based on Git branch for an improved multi-developer workflow. Enable **"Automatically delete head branches"** in your repo settings so merged branch stacks are cleaned up automatically via the destroy workflow
- **📦 Automated Dependency Management**: Dependabot creates grouped PRs with auto-approval for passing checks, streamlining updates while maintaining stability

<!-- TIP-LIST:START -->
> [!TIP]
> **Stop AWS bill surprises from happening.**
>
> Most infrastructure changes look harmless until you see next month's AWS bill. [CloudBurn](https://cloudburn.io) prevents this by analyzing the cost impact of your AWS CDK changes directly in GitHub pull requests, catching expensive mistakes during code review when fixes are quick, not weeks later when they're costly and risky.
>
> <a href="https://github.com/marketplace/cloudburn-io"><img alt="Install CloudBurn from GitHub Marketplace" src="https://img.shields.io/badge/Install%20CloudBurn-GitHub%20Marketplace-brightgreen.svg?style=for-the-badge&logo=github"/></a>
>
> <details>
> <summary>💰 <strong>Set it up once, then never be surprised by AWS costs again</strong></summary>
> <br/>
>
> 1. **First install the free [CDK Diff PR Commenter GitHub Action](https://github.com/marketplace/actions/aws-cdk-diff-pr-commenter)** in your repository where you build your AWS CDK infrastructure
> 2. **Then install the [CloudBurn GitHub App](https://github.com/marketplace/cloudburn-io)** on the same repository
>
> **What happens now:**
>
> Whenever you open a PR with infrastructure changes, the GitHub Action comments with your CDK diff analysis. CloudBurn reads that diff and automatically adds a separate comment with a detailed cost report showing:
> - **Monthly cost impact** – Will this change increase or decrease your AWS bill? By how much?
> - **Per-resource breakdown** – See exactly which resources are driving costs (old vs. new monthly costs)
> - **Region-aware pricing** – We pick the right AWS pricing based on the region where your infrastructure is deployed
>
> Your team can now validate cost impact alongside infrastructure changes during code review. Essentially, this shifts FinOps left where you optimize costs as you code, not weeks later when context is lost and production adjustments require more time and carry added risk.
>
> CloudBurn will be free during beta. After launch, a free Community plan (1 repository with unlimited users) will always be available.
>
> </details>
<!-- TIP-LIST:END -->

## Quick Start

This project requires at least **Node.js version 22**.

**To get started, follow these steps:**

1. Click the green ["Use this template"](https://github.com/new?template_name=aws-cdk-starter-kit&template_owner=towardsthecloud) button to create a new repository based on this starter kit.

2. Install the project dependencies using: `npm ci`

3. Customize the AWS Region and Account IDs in the [.projenrc.ts](./.projenrc.ts) file to match your AWS setup.

4. Run `npx projen` to generate the GitHub Actions workflow files.

5. Ensure you're logged into an AWS Account via the AWS CLI.

6. Deploy the CDK toolkit stack with `cdk bootstrap` if it's not already set up.

7. Deploy the GitHub OIDC Stack to enable GitHub Actions workflow permissions for AWS deployments.

8. Commit and push your changes to the `main` branch to trigger the CDK deploy pipeline in GitHub.

Congratulations! You've successfully set up your project.

## 📚 Full Documentation

For detailed setup instructions, architecture explanations, and advanced usage guides, visit the **[→ official documentation](https://towardsthecloud.com/docs/aws-cdk-starter-kit)**.
## Acknowledgements

A heartfelt thank you to the creators of [projen](https://github.com/projen/projen). This starter kit stands on the shoulders of giants, made possible by their pioneering work in simplifying cloud infrastructure projects!

## Author

[Danny Steenman](https://towardsthecloud.com/about)

[![](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/company/towardsthecloud)
[![](https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white)](https://twitter.com/dannysteenman)
[![](https://img.shields.io/badge/GitHub-2b3137?style=for-the-badge&logo=github&logoColor=white)](https://github.com/towardsthecloud)
