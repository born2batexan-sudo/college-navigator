import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_CHECKPOINTS, DOMAINS } from "../lib/checkpoints";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const landing = read("../components/CampusPassageLanding.tsx");
const header = read("../components/MarketingHeader.tsx");
const nav = read("../components/HeaderNav.tsx");
const footer = read("../components/MarketingFooter.tsx");
const layout = read("../app/layout.tsx");
const request = read("../app/request-access/page.tsx");
const all = `${landing}\n${header}\n${nav}\n${footer}\n${layout}\n${request}`;

describe("approved public release copy", () => {
  it("has the real 12-by-12 operational index behind the public up-to-144 claim", () => {
    assert.equal(DOMAINS.length, 12);
    assert.ok(DOMAINS.every((d) => d.titles.length === 12));
    assert.equal(ALL_CHECKPOINTS.length, 144);
    assert.equal(new Set(ALL_CHECKPOINTS.map((x) => x.code)).size, 144);
    assert.equal(new Set(ALL_CHECKPOINTS.map((x) => x.title)).size, 144);
    assert.match(landing, /Up to 144 checks per school, per term\./);
    assert.match(landing, /verified, under review, not yet published, not applicable, conflicting, or withheld/);
  });

  it("publishes only approved commercial terms", () => {
    assert.match(header, /\$99 per household, per application cycle/);
    assert.match(landing, /Standard price <s>\$199<\/s>/);
    assert.match(landing, /10 unique colleges are included; each additional college is \$19/);
    assert.match(landing, /No subscription\. No auto-renewal\./);
    assert.doesNotMatch(all, /unlimited|any number of schools|per semester|automatic renewal/i);
  });

  it("removes preview artifacts, unsupported tallies, dead links, and uncleared comparison claims", () => {
    assert.doesNotMatch(all, /MOCKUP:|pending Marc|Isolated preview|verified run data/);
    assert.doesNotMatch(all, /\[State\]|\[Term\]|\[A\]|\[N\]|\[U\]/);
    assert.doesNotMatch(all, /href="#"/);
    assert.doesNotMatch(all, /\$150[\s\S]{0,30}\$2,500|Private Prep|Cost of College Admissions Consultants/);
  });

  it("keeps product boundaries and evidence qualifications explicit", () => {
    assert.match(landing, /Official sources on verified findings/);
    assert.match(landing, /instead of guessing or padding the list/);
    assert.match(landing, /does not apply to a school, submit or complete forms, sign into a portal, decide eligibility or awards, pay a bill/);
    assert.match(landing, /School portals and official instructions remain the authority/);
    assert.doesNotMatch(landing, /144 verified|guarantees eligibility|complete your application/i);
  });

  it("makes request access non-purchasing and consent based", () => {
    assert.match(request, /This form does not collect payment/);
    assert.match(request, /Submitting this form does not purchase or guarantee access/);
    assert.match(request, /I consent to Campus Passage using my name and email to review this access request/);
    assert.match(request, /This does not subscribe you to marketing/);
    assert.match(request, /Do not send passwords, payment details, application materials, school records, or financial information/);
  });

  it("retains the approved page structure and navigation", () => {
    for (const id of ["top", "why-it-matters", "how", "standard", "the-journey", "sample", "trust", "boundaries", "pricing", "founders", "faq", "next-step"]) {
      assert.match(landing, new RegExp(`id="${id}"`));
    }
    assert.match(nav, /12² Standard/);
    assert.match(nav, /Pricing/);
    assert.match(footer, /Connected-mail privacy/);
    assert.match(footer, /Request access/);
    assert.match(footer, /Log in/);
  });

  it("keeps controlled public indexing and excludes analytics or real-school marketing claims", () => {
    assert.match(layout, /index: false/);
    assert.doesNotMatch(all, /gtag\(|G-[A-Z0-9]{8,}|application\/ld\+json/);
    assert.doesNotMatch(all, /Michigan State|Grand Valley|Western Michigan|Texas State|University of Texas/);
  });
});
