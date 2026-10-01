import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { requireAgentAuth } from "../app/api/agent/_auth";

function request(token: string) {
  return new NextRequest("https://staging.example.test/api/agent/sources", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("staging monitor machine authorization", () => {
  it("opens only on preview with explicit gates and delivery off", () => {
    const previous = { ...process.env };
    try {
      Object.assign(process.env, {
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        MONITORING_API_ENABLED: "1",
        MONITORING_PIPELINE_ENABLED: "1",
        MONITORING_DELIVERY_ENABLED: "0",
        MONITOR_API_KEY: "monitor-secret",
      });
      assert.equal(requireAgentAuth(request("monitor-secret"), "monitor"), null);
      const wrong = requireAgentAuth(request("wrong"), "monitor");
      assert.equal(wrong?.status, 401);
      assert.equal(wrong?.headers.get("cache-control"), "no-store");
      process.env.MONITORING_DELIVERY_ENABLED = "1";
      assert.equal(requireAgentAuth(request("monitor-secret"), "monitor")?.status, 404);
      process.env.MONITORING_DELIVERY_ENABLED = "0";
      process.env.VERCEL_ENV = "production";
      assert.equal(requireAgentAuth(request("monitor-secret"), "monitor")?.status, 404);
      delete process.env.VERCEL_ENV;
      assert.equal(requireAgentAuth(request("monitor-secret"), "monitor")?.status, 404);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });
});

describe("staging queue machine authorization", () => {
  it("requires the review Preview even when all queue and research flags are on", () => {
    const previous = { ...process.env };
    try {
      Object.assign(process.env, {
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        REQUEST_PIPELINE_ENABLED: "1",
        REQUEST_QUEUE_ENABLED: "1",
        RESEARCH_API_ENABLED: "1",
        QUEUE_AGENT_API_KEY: "queue-secret",
      });
      assert.equal(requireAgentAuth(request("queue-secret"), "queue"), null);
      assert.equal(requireAgentAuth(request("wrong"), "queue")?.status, 401);
      process.env.VERCEL_ENV = "production";
      assert.equal(requireAgentAuth(request("queue-secret"), "queue")?.status, 404);
      delete process.env.VERCEL_ENV;
      assert.equal(requireAgentAuth(request("queue-secret"), "queue")?.status, 404);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });
});
