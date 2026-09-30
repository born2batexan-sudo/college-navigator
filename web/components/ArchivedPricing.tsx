import Link from "next/link";
/** Preserved historical pricing UI; intentionally unrendered in the no-payment release. */
export default function ArchivedPricing(){return (<>
        <section id="pricing" className="section" aria-labelledby="pricing-title">
          <div className="site-shell center">
            <p className="eyebrow">Pricing</p>
            <h2 id="pricing-title" className="display">The simplest $199 you&apos;ll spend on college.</h2>
            <p className="lead lead-centered">One price per household. Every eligible student in the same application cycle. No subscription.</p>
            <p className="replaces">The spreadsheet. The sticky notes. The inbox searches. The 11 p.m. double-checks.</p>
            <div className="price">
              <span className="badge">LIMITED-TIME FOUNDING-FAMILY SPECIAL</span>
              <div className="std">Standard price <s>$199</s> <span>per qualifying household, per application cycle</span></div>
              <div className="p99"><span className="n">$99</span><span>per household, per application cycle</span></div>
              <div className="elig">Founding families only · Limited time</div>
              <p className="fine coverage">Covers the eligible students in a qualifying household who share the same high-school graduation year and application cycle. 10 unique colleges are included; each additional college is $19.</p>
              <ul className="check"><li>Every eligible student in your household, same application cycle</li><li>10 unique colleges included; $19 per additional college</li><li>Up to 144 checks per school, per term</li><li>No subscription. No auto-renewal.</li></ul>
              <Link className="button button-primary" href="/request-access">Claim the $99 founding price</Link>
              <p className="fine price-foot">Founding families pay $99 per household, per application cycle, after approval. When the offer ends, the price is $199 per qualifying household, per application cycle.</p>
            </div>
            <div className="stats">
              <div className="stat"><div className="n">Up to 144</div><div>checks per school</div></div>
              <div className="stat"><div className="n">Up to 1,152</div><div>checks for a student weighing 8 schools</div></div>
              <div className="stat"><div className="n">About 17¢</div><div>per check at $199 (under 9¢ at the founding price)</div></div>
            </div>
            <p className="fine">&quot;Up to&quot; because not every check applies at every school. 8 schools is an example: 10 unique colleges are included, and each additional college is $19. Per-check figures divide the price by 1,152 checks.</p>
          </div>
        </section>

    </>);}
