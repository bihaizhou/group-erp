//#region modules/base64.ts
/**
* Helper class to base64 encode/decode values with option
* for url encoding and decoding
*/
var Base64 = class {
	encode(data, encoding) {
		if (typeof data === "string") return Buffer.from(data, encoding).toString("base64");
		if (Buffer.isBuffer(data)) return data.toString("base64");
		return Buffer.from(data).toString("base64");
	}
	decode(encoded, encoding = "utf-8", strict = false) {
		if (Buffer.isBuffer(encoded)) return encoded.toString(encoding);
		const decoded = Buffer.from(encoded, "base64").toString(encoding);
		const isInvalid = this.encode(decoded, encoding) !== encoded;
		if (strict && isInvalid) throw new Error("Cannot decode malformed value");
		return isInvalid ? null : decoded;
	}
	urlEncode(data, encoding) {
		return (typeof data === "string" ? this.encode(data, encoding) : this.encode(data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/\=/g, "");
	}
	urlDecode(encoded, encoding = "utf-8", strict = false) {
		if (Buffer.isBuffer(encoded)) return encoded.toString(encoding);
		const decoded = Buffer.from(encoded, "base64").toString(encoding);
		const isInvalid = this.urlEncode(decoded, encoding) !== encoded;
		if (strict && isInvalid) throw new Error("Cannot urlDecode malformed value");
		return isInvalid ? null : decoded;
	}
};
const base64 = new Base64();
//#endregion
export { base64 as default };
