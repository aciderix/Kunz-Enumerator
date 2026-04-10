import { KunzCtx, createResult, generate_prefixes, ctx_verify_carry, ctx_compute_and_record, ctx_rec_sync, reduce_into } from './lib/kunz';

let shouldStop = false;

self.onmessage = async (e) => {
    if (e.data.type === 'STOP') {
        shouldStop = true;
    } else if (e.data.type === 'START_TASK') {
        shouldStop = false;
        const { m, k_max, d_min, d_max, w_max, has_w_max } = e.data.payload;
        
        const finalResult = createResult(m);
        
        // Determine prefix length for chunking. 
        // If m is small, plen can be m-1. If m is large, plen = 3 or 4.
        const plen = Math.min(m - 1, 3);
        const prefixes = generate_prefixes(m, k_max, plen);
        
        let processedPrefixes = 0;
        let lastReportTime = performance.now();
        const startTime = performance.now();

        for (const prefix of prefixes) {
            if (shouldStop) {
                self.postMessage({ type: 'STOPPED' });
                return;
            }

            const ctx: KunzCtx = {
                m, k_max, d_min, d_max, w_max, has_w_max,
                K: new Array(m).fill(0),
                res: createResult(m)
            };

            // Setup prefix
            let validPrefix = true;
            for (let r = 1; r <= plen; r++) {
                let v = prefix[r - 1];
                if (v < 1 || v > k_max) { validPrefix = false; break; }
                for (let a = 1; a < r; a++) {
                    let b = r - a;
                    if (v > prefix[a - 1] + prefix[b - 1]) { validPrefix = false; break; }
                }
                ctx.K[r - 1] = v;
            }

            if (validPrefix) {
                if (plen === m - 1) {
                    ctx.res.leaves_raw++;
                    if (ctx_verify_carry(ctx)) {
                        ctx.res.leaves_valid++;
                        ctx_compute_and_record(ctx);
                    }
                } else {
                    ctx_rec_sync(ctx, plen + 1);
                }
                reduce_into(finalResult, ctx.res, m);
            }

            processedPrefixes++;
            
            const now = performance.now();
            if (now - lastReportTime > 200) { // Report progress every 200ms
                self.postMessage({ 
                    type: 'PROGRESS', 
                    payload: { 
                        progress: processedPrefixes / prefixes.length,
                        currentResult: finalResult
                    } 
                });
                lastReportTime = now;
                // Yield to event loop to receive STOP messages
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (!shouldStop) {
            const timeTakenMs = performance.now() - startTime;
            self.postMessage({ type: 'DONE', payload: { result: finalResult, timeTakenMs } });
        }
    }
};
