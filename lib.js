/**
 * Library of simple functions for use in all other modules.
 * This libary should be clean and not depend on any other modules.
 */

/**
   Find the first x in `values` that's larger than `cur`.
   Cycle to first value if no larger value is found.
   `values` should be sorted in ascending order.
 */
export function findNext(cur, values, slack = 0) {
    for (let i = 0; i < values.length; i++) {
        let x = values[i];
        if (cur < x) {
            if (x - cur < slack) {
                // Consider `cur` practically equal to `x`
                continue;
            } else {
                return x;
            }
        }
    }
    return values[0]; // cycle
}

export function findPrev(cur, values, slack = 0) {
    let i = 0;
    for (;i < values.length; i++) {
        let x = values[i];
        if (x + slack >= cur) {
            break;
        }
    }
    let target_i = i - 1;
    if (target_i < 0) {
        target_i = values.length - 1;
    }

    return values[target_i];
}

export function arrayEqual(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}

/** Is the floating point numbers equal enough */
export function eq(a, b, epsilon = 0.00000001) {
    return Math.abs(a - b) < epsilon;
}

export function swap(array, i, j) {
    let temp = array[i];
    array[i] = array[j];
    array[j] = temp;
}

export function in_bounds(array, i) {
    return i >= 0 && i < array.length;
}

export function indent(level, str) {
    let blank = "";
    for (let i = 0; i < level; i++) {
        blank += "  ";
    }
    return blank + str;
}

export function sum(array) {
    return array.reduce((a, b) => a + b, 0);
}

export function zip(...as) {
    let r = [];
    let minLength = Math.min(...as.map(x => x.length));
    for (let i = 0; i < minLength; i++) {
        r.push(as.map(a => a[i]));
    }
    return r;
}
