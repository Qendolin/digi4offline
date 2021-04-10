export class Message {
	/**
	 * @param {string} action
	 * @param {any} data
	 */
	constructor(action, data) {
		this.action = action;
		this.data = data;
	}
}
