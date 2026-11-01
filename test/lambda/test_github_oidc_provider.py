"""The GitHub OIDC provider handler creates the account's provider or adopts the one it finds.

`FakeIam` keeps one account's OIDC providers. Observed in a workload account
(October 2026, read-only): `GetOpenIDConnectProvider` returns `Url` without the
`https://` scheme, `ClientIDList`, `ThumbprintList`, `CreateDate` and `Tags`
(an empty list when untagged), and an unknown provider ARN raises `NoSuchEntity`.
A provider created without `ThumbprintList` reads back with one that IAM chose.
From the IAM API reference: `CreateOpenIDConnectProvider` raises
`EntityAlreadyExists` for a URL the account already registered, accepts `Tags`,
and makes `ThumbprintList` optional; `AddClientIDToOpenIDConnectProvider` and
`DeleteOpenIDConnectProvider` act on the provider ARN.

The handler runs on the PYTHON_3_14 Lambda runtime where boto3 is provided;
locally the boto3 import is stubbed so only stdlib is needed.
"""

import importlib.util
import sys
import types
import unittest
from pathlib import Path

ASSET_INDEX = (
    Path(__file__).resolve().parents[2] / "src/assets/lambda/github-oidc-provider/index.py"
)

ACCOUNT = "576607007462"
FUNCTION_ARN = f"arn:aws:lambda:eu-west-1:{ACCOUNT}:function:handler"
URL = "https://token.actions.githubusercontent.com"
ARN = f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
OWNER_TAG = {"Key": "aws-cdk-starter-kit:github-oidc-provider", "Value": "created"}


class FakeIamError(Exception):
    def __init__(self, code, operation):
        super().__init__(
            f"An error occurred ({code}) when calling the {operation} operation"
        )
        self.response = {"Error": {"Code": code}}


class FakeIam:
    """One account's OIDC providers, keyed by ARN. `failures` raises once per named call."""

    def __init__(self, providers=None, failures=None, created_concurrently=None):
        self.providers = providers or {}
        self.failures = dict(failures or {})
        # Providers another creator registers just before this handler's create lands.
        self.created_concurrently = created_concurrently or {}
        self.calls = []

    def _call(self, name):
        self.calls.append(name)
        failure = self.failures.pop(name, None)
        if failure:
            raise failure

    def _provider(self, arn, operation):
        if arn not in self.providers:
            raise FakeIamError("NoSuchEntity", operation)
        return self.providers[arn]

    def get_open_id_connect_provider(self, OpenIDConnectProviderArn):
        self._call("get")
        provider = self._provider(OpenIDConnectProviderArn, "GetOpenIDConnectProvider")
        return {
            "Url": provider["Url"],
            "ClientIDList": list(provider["ClientIDList"]),
            "ThumbprintList": ["2b18947a6a9fc7764fd8b5fb18a863b0c6dac24f"],
            "Tags": list(provider["Tags"]),
        }

    def create_open_id_connect_provider(self, Url, ClientIDList, Tags):
        self._call("create")
        self.providers.update(self.created_concurrently)
        host = Url.removeprefix("https://")
        arn = f"arn:aws:iam::{ACCOUNT}:oidc-provider/{host}"
        if arn in self.providers:
            raise FakeIamError("EntityAlreadyExists", "CreateOpenIDConnectProvider")
        self.providers[arn] = {
            "Url": host,
            "ClientIDList": list(ClientIDList),
            "Tags": list(Tags),
        }
        return {"OpenIDConnectProviderArn": arn}

    def add_client_id_to_open_id_connect_provider(
        self, OpenIDConnectProviderArn, ClientID
    ):
        self._call("add_client_id")
        provider = self._provider(
            OpenIDConnectProviderArn, "AddClientIDToOpenIDConnectProvider"
        )
        if ClientID not in provider["ClientIDList"]:
            provider["ClientIDList"].append(ClientID)

    def delete_open_id_connect_provider(self, OpenIDConnectProviderArn):
        self._call("delete")
        self._provider(OpenIDConnectProviderArn, "DeleteOpenIDConnectProvider")
        del self.providers[OpenIDConnectProviderArn]


def foreign_provider(client_ids=("sts.amazonaws.com",)):
    """A provider another stack created, such as a landing zone's CDK bootstrap StackSet."""
    return {
        ARN: {
            "Url": "token.actions.githubusercontent.com",
            "ClientIDList": list(client_ids),
            "Tags": [],
        }
    }


def load_handler(iam):
    boto3_stub = sys.modules.get("boto3") or types.ModuleType("boto3")
    boto3_stub.client = lambda service, **_kwargs: {"iam": iam}[service]  # ty: ignore[unresolved-attribute]
    sys.modules["boto3"] = boto3_stub
    spec = importlib.util.spec_from_file_location("github_oidc_provider", ASSET_INDEX)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Context:
    invoked_function_arn = FUNCTION_ARN


def event(request_type, physical_id=None, client_ids=("sts.amazonaws.com",)):
    # The provider framework delivers list properties as lists and adds ServiceToken.
    result = {
        "RequestType": request_type,
        "ResourceProperties": {
            "ServiceToken": "token",
            "url": URL,
            "clientIds": list(client_ids),
        },
    }
    if physical_id:
        result["PhysicalResourceId"] = physical_id
    return result


class GitHubOidcProviderTest(unittest.TestCase):
    def run_event(self, iam, request_type, **kwargs):
        return load_handler(iam).on_event(event(request_type, **kwargs), Context())

    def test_create_registers_a_tagged_provider_when_the_account_has_none(self):
        iam = FakeIam()
        response = self.run_event(iam, "Create")
        self.assertEqual(response, {"PhysicalResourceId": ARN})
        self.assertEqual(
            iam.providers[ARN],
            {
                "Url": "token.actions.githubusercontent.com",
                "ClientIDList": ["sts.amazonaws.com"],
                "Tags": [OWNER_TAG],
            },
        )

    def test_create_adopts_a_foreign_provider_without_tagging_or_replacing_it(self):
        iam = FakeIam(foreign_provider())
        response = self.run_event(iam, "Create")
        self.assertEqual(response["PhysicalResourceId"], ARN)
        self.assertEqual(iam.providers, foreign_provider())
        self.assertNotIn("create", iam.calls)

    def test_create_adds_a_missing_audience_and_keeps_the_others(self):
        iam = FakeIam(foreign_provider(client_ids=["my-app"]))
        self.run_event(iam, "Create")
        self.assertEqual(
            iam.providers[ARN]["ClientIDList"], ["my-app", "sts.amazonaws.com"]
        )

    def test_create_retry_after_a_lost_response_adopts_its_own_provider(self):
        iam = FakeIam()
        self.run_event(iam, "Create")
        response = self.run_event(iam, "Create")
        self.assertEqual(response["PhysicalResourceId"], ARN)
        self.assertEqual(iam.calls.count("create"), 1)
        self.assertEqual(iam.providers[ARN]["Tags"], [OWNER_TAG])

    def test_create_that_races_another_creator_adopts_the_winner(self):
        # Another stack registers the provider between the read and the create.
        iam = FakeIam(created_concurrently=foreign_provider())
        response = self.run_event(iam, "Create")
        self.assertEqual(response["PhysicalResourceId"], ARN)
        self.assertEqual(iam.providers, foreign_provider())

    def test_update_recreates_a_provider_deleted_outside_the_stack(self):
        iam = FakeIam()
        response = self.run_event(iam, "Update", physical_id=ARN)
        self.assertEqual(response["PhysicalResourceId"], ARN)
        self.assertEqual(iam.providers[ARN]["Tags"], [OWNER_TAG])

    def test_delete_removes_the_provider_the_handler_created(self):
        iam = FakeIam()
        self.run_event(iam, "Create")
        response = self.run_event(iam, "Delete", physical_id=ARN)
        self.assertEqual(response, {"PhysicalResourceId": ARN})
        self.assertEqual(iam.providers, {})

    def test_delete_keeps_an_adopted_provider(self):
        iam = FakeIam(foreign_provider(client_ids=["my-app"]))
        self.run_event(iam, "Create")
        self.run_event(iam, "Delete", physical_id=ARN)
        # The audience the handler added stays: roles outside the stack may rely on it.
        self.assertEqual(
            iam.providers[ARN]["ClientIDList"], ["my-app", "sts.amazonaws.com"]
        )
        self.assertNotIn("delete", iam.calls)

    def test_delete_of_an_absent_provider_succeeds(self):
        iam = FakeIam()
        response = self.run_event(iam, "Delete", physical_id=ARN)
        self.assertEqual(response["PhysicalResourceId"], ARN)
        self.assertEqual(iam.calls, ["get"])

    def test_delete_that_loses_a_race_with_another_deleter_succeeds(self):
        iam = FakeIam(
            failures={
                "delete": FakeIamError("NoSuchEntity", "DeleteOpenIDConnectProvider")
            }
        )
        self.run_event(iam, "Create")
        self.run_event(iam, "Delete", physical_id=ARN)
        self.assertEqual(iam.calls.count("delete"), 1)

    def test_delete_after_a_failed_create_cleans_up_by_the_derived_identity(self):
        # A Create that failed after registering the provider returns no ARN, so the
        # rollback's Delete carries the provider framework's placeholder ID.
        iam = FakeIam()
        self.run_event(iam, "Create")
        response = self.run_event(iam, "Delete", physical_id="placeholder-request-id")
        self.assertEqual(response["PhysicalResourceId"], "placeholder-request-id")
        self.assertEqual(iam.providers, {})

    def test_other_errors_propagate(self):
        for request_type in ("Create", "Delete"):
            with self.subTest(request_type=request_type):
                iam = FakeIam(
                    failures={
                        "get": FakeIamError("AccessDenied", "GetOpenIDConnectProvider")
                    }
                )
                with self.assertRaises(FakeIamError):
                    self.run_event(iam, request_type, physical_id=ARN)

    def test_a_create_conflict_that_leaves_no_provider_fails(self):
        iam = FakeIam(
            failures={
                "create": FakeIamError(
                    "EntityAlreadyExists", "CreateOpenIDConnectProvider"
                )
            }
        )
        with self.assertRaisesRegex(RuntimeError, "then as absent"):
            self.run_event(iam, "Create")


if __name__ == "__main__":
    unittest.main()
