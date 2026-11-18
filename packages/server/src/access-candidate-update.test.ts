import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteStore } from "./db.js";
import { EventBus } from "./event-bus.js";
import { createBridgeHttp, isLoopbackAddress } from "./http.js";
import { SessionService } from "./session-service.js";

describe("internal access candidate updates", () => {
  let store: SqliteStore | null = null;

  afterEach(() => {
    store?.close();
    store = null;
  });

  function createBridge() {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);
    return createBridgeHttp({
      accessCandidates: [],
      authToken: "secret",
      eventBus,
      runtime: null,
      service,
    });
  }

  it("accepts only Bearer-authenticated loopback updates and reflects them in health", async () => {
    const bridge = createBridge();
    const candidates = Array.from({ length: 9 }, (_, index) => ({
      kind: index === 0 ? "local" : "lan",
      label: `Address ${index}`,
      url: `http://192.168.1.${index + 1}:8790/?token=secret`,
    }));
    candidates.splice(2, 0, { ...candidates[1]!, label: "Duplicate URL" });

    await request(bridge.app)
      .post("/api/access-candidates?token=secret")
      .send({ accessCandidates: candidates })
      .expect(401);

    const update = await request(bridge.app)
      .post("/api/access-candidates")
      .set("Authorization", "Bearer secret")
      .send({ accessCandidates: candidates })
      .expect(200);

    expect(update.body.accessCandidates).toHaveLength(8);
    expect(update.body.accessCandidates.map((candidate: { label: string }) => candidate.label)).not.toContain(
      "Duplicate URL",
    );

    const health = await request(bridge.app)
      .get("/api/health")
      .set("Authorization", "Bearer secret")
      .expect(200);
    expect(health.body.accessCandidates).toEqual(update.body.accessCandidates);
  });

  it("rejects invalid schema without replacing the current candidates", async () => {
    const bridge = createBridge();
    const original = [
      {
        kind: "local",
        label: "This Mac",
        url: "http://127.0.0.1:8790/?token=secret",
      },
    ];

    await request(bridge.app)
      .post("/api/access-candidates")
      .set("Authorization", "Bearer secret")
      .send({ accessCandidates: original })
      .expect(200);
    await request(bridge.app)
      .post("/api/access-candidates")
      .set("Authorization", "Bearer secret")
      .send({
        accessCandidates: [{ kind: "lan", label: "Wrong protocol", url: "ftp://192.168.1.2" }],
      })
      .expect(400);
    await request(bridge.app)
      .post("/api/access-candidates")
      .set("Authorization", "Bearer secret")
      .send({
        accessCandidates: [
          ...Array.from({ length: 8 }, (_, index) => ({
            kind: "lan",
            label: `Valid ${index}`,
            url: `http://192.168.1.${index + 1}:8790/`,
          })),
          { kind: "lan", label: "Invalid tail", url: "ftp://192.168.1.99" },
        ],
      })
      .expect(400);
    await request(bridge.app)
      .post("/api/access-candidates")
      .set("Authorization", "Bearer secret")
      .send({
        accessCandidates: Array.from({ length: 65 }, (_, index) => ({
          kind: "lan",
          label: `Raw ${index}`,
          url: `http://10.0.${Math.floor(index / 255)}.${(index % 255) + 1}:8790/`,
        })),
      })
      .expect(400);

    const health = await request(bridge.app)
      .get("/api/health")
      .set("Authorization", "Bearer secret")
      .expect(200);
    expect(health.body.accessCandidates).toEqual(original);
  });

  it("recognizes loopback socket forms but rejects external sources", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.20")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
