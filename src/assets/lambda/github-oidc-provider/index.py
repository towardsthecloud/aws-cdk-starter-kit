"""Create the account's GitHub Actions OIDC provider, or adopt the one it has.

IAM registers one provider per issuer URL in an account, so a second stack that
declares the same provider fails with `EntityAlreadyExists`. This resource
converges instead:

- Create and Update read the provider by its ARN, which the account and the
  issuer URL fix. When it is absent the handler creates it; when it exists,
  whoever created it, the handler adopts it and adds any missing client ID. It
  never removes a client ID.
- Delete never removes the provider or a client ID. Roles outside the stack,
  such as a workload repository's deploy role, may trust the provider, and the
  handler can't tell whether one still does. A provider grants nothing until a
  role trusts it, and adding the construct back adopts it again.

The physical ID is the provider ARN.
"""

boto3 = __import__("boto3")
time = __import__("time")
Config = __import__("botocore.config", fromlist=["Config"]).Config

# Kept free after the handler returns so the provider framework can respond to CloudFormation.
RESPONSE_MARGIN_SECONDS = 30
CONNECT_TIMEOUT_SECONDS = 5
READ_TIMEOUT_SECONDS = 15


def on_event(event, context):
    if event["RequestType"] == "Delete":
        print("Keeping the GitHub OIDC provider: roles outside the stack may trust it")
        return {"PhysicalResourceId": event["PhysicalResourceId"]}

    props = event["ResourceProperties"]
    _, partition, _, _, account = context.invoked_function_arn.split(":")[:5]
    host = props["url"].removeprefix("https://")
    arn = f"arn:{partition}:iam::{account}:oidc-provider/{host}"
    ensure_provider(bounded_iam_client(context), arn, props["url"], props["clientIds"])
    return {"PhysicalResourceId": arn}


def bounded_iam_client(context):
    """IAM client whose every wire attempt, retries included, ends before the invocation deadline.

    Socket timeouts bound a stalled call, and the before-send guard fails an
    attempt outright once it could no longer finish in time, so CloudFormation
    gets a retryable failure instead of a Lambda timeout.
    """
    deadline = (
        time.monotonic()
        + context.get_remaining_time_in_millis() / 1000
        - RESPONSE_MARGIN_SECONDS
    )
    client = boto3.client(
        "iam",
        config=Config(
            connect_timeout=CONNECT_TIMEOUT_SECONDS,
            read_timeout=READ_TIMEOUT_SECONDS,
            retries={"mode": "standard", "total_max_attempts": 3},
        ),
    )

    def before_send(**_kwargs):
        if time.monotonic() + CONNECT_TIMEOUT_SECONDS + READ_TIMEOUT_SECONDS >= deadline:
            raise RuntimeError(
                "Invocation deadline reached before an IAM call could complete; redeploy to retry"
            )

    client.meta.events.register("before-send", before_send)
    return client


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
            iam.create_open_id_connect_provider(Url=url, ClientIDList=client_ids)
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

