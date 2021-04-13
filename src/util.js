/**
 * @param {number} times
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function retryAsync(times, fn) {
	times = Math.max(times, 1);
	do {
		const res = await fn();
		if (res !== undefined) return res;
		times--;
	} while (times > 0);
	return undefined;
}

/**
 * @see https://stackoverflow.com/a/55008541/7448536
 * @param {number[]} numbers
 */
export function findRanges(numbers) {
	return [...numbers]
		.sort((a, b) => a - b)
		.reduce(
			(acc, x, i) => {
				if (i === 0) {
					acc.ranges.push(x);
					acc.rangeStart = x;
				} else {
					if (x === acc.last + 1) {
						acc.ranges[acc.ranges.length - 1] = acc.rangeStart + '-' + x;
					} else {
						acc.ranges.push(x);
						acc.rangeStart = x;
					}
				}
				acc.last = x;
				return acc;
			},
			{ ranges: [], rangeStart: null, last: null }
		)
		.ranges.join('_');
}

/**
 * @see https://stackoverflow.com/a/31394257/7448536
 * @param {Buffer} buffer
 * @returns {ArrayBuffer}
 */
export function toArrayBuffer(buffer) {
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export class DetailError extends Error {
	/**
	 * @param {string} message
	 * @param {any} detail
	 */
	constructor(message, detail) {
		super(message);
		this.detail = detail;
	}
}

export class ResponseError extends DetailError {
	/**
	 * @param {string} message
	 * @param {import('node-fetch').Response} response
	 */
	constructor(message, response) {
		super(`${message}: invalid response: ${response.status}`, response);
	}
}

/**
 * @typedef PageRange
 * @property {number | string} from
 * @property {number | string} to
 */

/**
 * @typedef BufferRange
 * @property {number} start
 * @property {number} end
 */
