export interface KunzResult {
    counts: number[];
    W_neg: number[];
    W_min: number[];
    argmin_k: number[][];
    leaves_raw: number;
    leaves_valid: number;
    leaves_kept: number;
}

export interface KunzCtx {
    m: number;
    k_max: number;
    d_min: number;
    d_max: number;
    w_max: number;
    has_w_max: boolean;
    K: number[];
    res: KunzResult;
}

export function createResult(m: number): KunzResult {
    return {
        counts: new Array(m + 1).fill(0),
        W_neg: new Array(m + 1).fill(0),
        W_min: new Array(m + 1).fill(Number.MAX_SAFE_INTEGER),
        argmin_k: Array.from({ length: m + 1 }, () => new Array(m).fill(0)),
        leaves_raw: 0,
        leaves_valid: 0,
        leaves_kept: 0
    };
}

export function ctx_compute_and_record(c: KunzCtx) {
    const m = c.m;
    const n = m - 1;
    const K = c.K;

    let k_star = 0, r_star = 0;
    for (let i = 0; i < n; i++) {
        if (K[i] >= k_star) { k_star = K[i]; r_star = i + 1; }
    }
    let L = k_star;
    for (let i = 0; i < n; i++) {
        let res = i + 1;
        if (res <= r_star) L += (k_star - K[i]);
        else { let dlt = k_star - 1 - K[i]; if (dlt > 0) L += dlt; }
    }
    let F = (k_star - 1) * m + r_star;
    let cc = F + 1;

    let d = 0;
    for (let r = 1; r <= n; r++) {
        let kr = K[r - 1];
        let decomposable = 0;
        for (let a = 1; a <= n; a++) {
            let ka = K[a - 1];
            let b_nc = r - a;
            if (b_nc >= 1 && b_nc <= n) {
                if (ka + K[b_nc - 1] <= kr) { decomposable = 1; break; }
            }
            let b_c = r + m - a;
            if (b_c >= 1 && b_c <= n) {
                if (ka + K[b_c - 1] + 1 <= kr) { decomposable = 1; break; }
            }
        }
        if (decomposable) d++;
    }
    let e = m - d;
    let W = e * L - cc;

    if (d < c.d_min || d > c.d_max) return;
    if (c.has_w_max && W > c.w_max) return;

    let R = c.res;
    R.leaves_kept++;
    R.counts[d]++;
    if (W < 0) R.W_neg[d]++;
    if (R.counts[d] === 1 || W < R.W_min[d]) {
        R.W_min[d] = W;
        for (let i = 0; i < n; i++) R.argmin_k[d][i] = K[i];
    }
}

export function ctx_verify_carry(c: KunzCtx): boolean {
    const m = c.m;
    const n = m - 1;
    const K = c.K;
    for (let r = 1; r <= n; r++) {
        let kr = K[r - 1];
        for (let a = r + 1; a <= n; a++) {
            let b = r + m - a;
            if (b >= 1 && b <= n) {
                if (kr > K[a - 1] + K[b - 1] + 1) return false;
            }
        }
    }
    return true;
}

export function ctx_rec_sync(c: KunzCtx, r: number) {
    if (r === c.m) {
        c.res.leaves_raw++;
        if (ctx_verify_carry(c)) {
            c.res.leaves_valid++;
            ctx_compute_and_record(c);
        }
        return;
    }
    let ub = c.k_max;
    for (let a = 1; a < r; a++) {
        let b = r - a;
        let v = c.K[a - 1] + c.K[b - 1];
        if (v < ub) ub = v;
    }
    if (ub < 1) return;
    for (let val = 1; val <= ub; val++) {
        c.K[r - 1] = val;
        ctx_rec_sync(c, r + 1);
    }
}

export function generate_prefixes(m: number, k_max: number, plen: number): number[][] {
    let prefixes: number[][] = [];
    let K = new Array(plen).fill(0);
    
    function rec(r: number) {
        if (r === plen + 1) {
            prefixes.push([...K]);
            return;
        }
        let ub = k_max;
        for (let a = 1; a < r; a++) {
            let b = r - a;
            let v = K[a - 1] + K[b - 1];
            if (v < ub) ub = v;
        }
        if (ub < 1) return;
        for (let val = 1; val <= ub; val++) {
            K[r - 1] = val;
            rec(r + 1);
        }
    }
    rec(1);
    return prefixes;
}

export function reduce_into(dst: KunzResult, src: KunzResult, m: number) {
    dst.leaves_raw += src.leaves_raw;
    dst.leaves_valid += src.leaves_valid;
    dst.leaves_kept += src.leaves_kept;
    for (let d = 0; d <= m; d++) {
        if (!src.counts[d]) continue;
        let had = dst.counts[d] || 0;
        dst.counts[d] = had + src.counts[d];
        dst.W_neg[d] = (dst.W_neg[d] || 0) + src.W_neg[d];
        if (had === 0 || src.W_min[d] < dst.W_min[d]) {
            dst.W_min[d] = src.W_min[d];
            dst.argmin_k[d] = [...src.argmin_k[d]];
        }
    }
}
