"""Create the account's GitHub Actions OIDC provider, or adopt the one it has.

IAM registers one provider per issuer URL in an account, so a second stack that
declares the same provider fails with `EntityAlreadyExists`. This resource
converges instead:

- Create and Update read the provider by its ARN, which the account and the
  issuer URL fix. When it is absent the handler creates it, tagged as created
  here; when it exists, whoever created it, the handler adopts it and adds any
  missing client ID. It never removes a client ID or changes a provider's tags.
- Delete removes the provider only when it carries the created tag, so a
  provider another stack or a person registered stays. A client ID the handler
  added to an adopted provider stays too, since roles outside the stack may use
  it. With the construct's default `RETAIN` removal policy CloudFormation sends
  no Delete at all.

The physical ID is the provider ARN. Every request acts on the ARN the account
and the fixed issuer URL derive, which is the only provider the resource can
own, so a Delete after a Create that failed before it returned the ARN still
finds it.
"""

boto3 = __import__("boto3")

OWNER_TAG_KEY = "aws-cdk-starter-kit:github-oidc-provider"
OWNER_TAG_VALUE = "created"


def on_event(event, context):
    props = event["ResourceProperties"]
    _, partition, _, _, account = context.invoked_function_arn.split(":")[:5]
    host = props["url"].removeprefix("https://")
    arn = f"arn:{partition}:iam::{account}:oidc-provider/{host}"
    iam = boto3.client("iam")

    if event["RequestType"] == "Delete":
        delete_if_created(iam, arn)
        return {"PhysicalResourceId": event["PhysicalResourceId"]}

    ensure_provider(iam, arn, props["url"], props["clientIds"])
    return {"PhysicalResourceId": arn}


def error_code(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code")


def read_provider(iam, arn):
    """The provider, or None when IAM reports it absent."""
    try:
        return iam.get_open_id_connect_provider(OpenIDConnectProviderArn=arn)
    except Exception as error:
        if error_code(error) == "NoSuchEntity":
            return None
        raise


def ensure_provider(iam, arn, url, client_ids):
    provider = read_provider(iam, arn)
    if provider is None:
        try:
            iam.create_open_id_connect_provider(
                Url=url,
                ClientIDList=client_ids,
                Tags=[{"Key": OWNER_TAG_KEY, "Value": OWNER_TAG_VALUE}],
            )
            print(f"Created {arn}")
            return
        except Exception as error:
            if error_code(error) != "EntityAlreadyExists":
                raise
        # Another creator registered the URL between the read and the create.
        provider = read_provider(iam, arn)
        if provider is None:
            raise RuntimeError(
                f"IAM reported {arn} as existing, then as absent; redeploy to retry"
            )
    print(f"Adopted {arn}")
    for client_id in client_ids:
        if client_id not in provider["ClientIDList"]:
            iam.add_client_id_to_open_id_connect_provider(
                OpenIDConnectProviderArn=arn, ClientID=client_id
            )
            print(f"Added client ID {client_id} to {arn}")


def delete_if_created(iam, arn):
    provider = read_provider(iam, arn)
    if provider is None:
        print(f"{arn} is already absent")
        return
    tags = {tag["Key"]: tag["Value"] for tag in provider.get("Tags", [])}
    if tags.get(OWNER_TAG_KEY) != OWNER_TAG_VALUE:
        print(f"Keeping {arn}: this resource adopted it and did not create it")
        return
    try:
        iam.delete_open_id_connect_provider(OpenIDConnectProviderArn=arn)
    except Exception as error:
        if error_code(error) != "NoSuchEntity":
            raise
    print(f"Deleted {arn}")
