import { describe, test, expect, vi } from "vitest";
import { ListFunctionsCommand, GetFunctionUrlConfigCommand, GetPolicyCommand } from "@aws-sdk/client-lambda";
import { checkLambdaFunctionUrlNotPublic, checkLambdaNoWildcardResourcePolicy } from "../connectors/aws/tests/lambda.js";

const fn = (overrides = {}) => ({
  FunctionName: "process-uploads",
  FunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:process-uploads",
  ...overrides,
});

function notFound() {
  const err = new Error("not found");
  err.name = "ResourceNotFoundException";
  return err;
}

describe("checkLambdaFunctionUrlNotPublic", () => {
  test("reports not_applicable with no functions", async () => {
    const lambda = { send: vi.fn(async () => ({ Functions: [] })) };
    const results = await checkLambdaFunctionUrlNotPublic(lambda);
    expect(results[0].status).toBe("not_applicable");
  });

  test("reports not_applicable when no function has a Function URL configured", async () => {
    const lambda = {
      send: vi.fn(async (command) => {
        if (command instanceof ListFunctionsCommand) return { Functions: [fn()] };
        if (command instanceof GetFunctionUrlConfigCommand) throw notFound();
      }),
    };
    const results = await checkLambdaFunctionUrlNotPublic(lambda);
    expect(results[0].status).toBe("not_applicable");
  });

  test("fails a function URL with AuthType NONE", async () => {
    const lambda = {
      send: vi.fn(async (command) => {
        if (command instanceof ListFunctionsCommand) return { Functions: [fn()] };
        if (command instanceof GetFunctionUrlConfigCommand) return { AuthType: "NONE", FunctionUrl: "https://x.lambda-url.us-east-1.on.aws/" };
      }),
    };
    const results = await checkLambdaFunctionUrlNotPublic(lambda);
    expect(results[0].status).toBe("fail");
  });

  test("passes a function URL with AuthType AWS_IAM", async () => {
    const lambda = {
      send: vi.fn(async (command) => {
        if (command instanceof ListFunctionsCommand) return { Functions: [fn()] };
        if (command instanceof GetFunctionUrlConfigCommand) return { AuthType: "AWS_IAM", FunctionUrl: "https://x.lambda-url.us-east-1.on.aws/" };
      }),
    };
    const results = await checkLambdaFunctionUrlNotPublic(lambda);
    expect(results[0].status).toBe("pass");
  });
});

describe("checkLambdaNoWildcardResourcePolicy", () => {
  test("reports not_applicable with no functions", async () => {
    const lambda = { send: vi.fn(async () => ({ Functions: [] })) };
    const results = await checkLambdaNoWildcardResourcePolicy(lambda);
    expect(results[0].status).toBe("not_applicable");
  });

  test("passes a function with no resource policy attached", async () => {
    const lambda = {
      send: vi.fn(async (command) => {
        if (command instanceof ListFunctionsCommand) return { Functions: [fn()] };
        if (command instanceof GetPolicyCommand) throw notFound();
      }),
    };
    const results = await checkLambdaNoWildcardResourcePolicy(lambda);
    expect(results[0].status).toBe("pass");
  });

  test("fails a function whose policy grants a wildcard principal", async () => {
    const policy = {
      Statement: [{ Effect: "Allow", Principal: "*", Action: "lambda:InvokeFunction" }],
    };
    const lambda = {
      send: vi.fn(async (command) => {
        if (command instanceof ListFunctionsCommand) return { Functions: [fn()] };
        if (command instanceof GetPolicyCommand) return { Policy: JSON.stringify(policy) };
      }),
    };
    const results = await checkLambdaNoWildcardResourcePolicy(lambda);
    expect(results[0].status).toBe("fail");
  });

  test("passes a function whose policy grants only a specific principal", async () => {
    const policy = {
      Statement: [{ Effect: "Allow", Principal: { AWS: "arn:aws:iam::123456789012:role/other" }, Action: "lambda:InvokeFunction" }],
    };
    const lambda = {
      send: vi.fn(async (command) => {
        if (command instanceof ListFunctionsCommand) return { Functions: [fn()] };
        if (command instanceof GetPolicyCommand) return { Policy: JSON.stringify(policy) };
      }),
    };
    const results = await checkLambdaNoWildcardResourcePolicy(lambda);
    expect(results[0].status).toBe("pass");
  });
});
