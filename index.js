const { FtpSrv } = require('ftp-srv')
const Stream = require('stream')
const Path = require('path')
const fp = require('lodash/fp')

class WikiFs {
	constructor (core) {
		this._core = core
		this._cwd = '/'
	}

	_toKey (path) {
		return Path.resolve(this._cwd, path).slice(1)
	}

	async _prefix (prefix) {
		const start = prefix
		const end = `${prefix}\ufffd`
		const batches = []
		let offset = 0
		for (;;) {
			const batch = await this._core.keys({ start, end, offset })
			const { keys, limit } = batch
			batches.push(keys)

			if (keys.length < limit) { break }
			offset += limit
		}
		return batches.flat()
	}

	async _fileStat (key) {
		const entry = await this._core.get(key)
		if (entry.value === null) { return null }

		return {
			name: key.split('/').pop(),
			size: entry.value ? entry.value.length : 0,
			isDirectory: () => false,
			mtime: entry.modified,
		}
	}

	_dirStat (prefix) {
		const name = prefix.split('/').pop() || '/'
		return {
			name,
			size: 0,
			isDirectory: () => true,
			mtime: Date.now(),
		}
	}

	async _stat (prefix, _keys) {
		const keys = _keys || await this._prefix(prefix)

		if (keys.length === 1 && keys[0] === prefix) {
			return this._fileStat(prefix)
		}

		return this._dirStat(prefix)
	}

	currentDirectory () {
		return this._cwd
	}

	async get (fileName) {
		const key = this._toKey(fileName)
		const stats = await this._stat(key)
		if (!stats) { throw new Error("not found") }
		return stats
	}

	async list (path = '.') {
		const _prefix = this._toKey(path)
		const prefix = _prefix ? `${_prefix}/` : ''
		const keys = await this._prefix(prefix)
		const list = await Promise
			.all(fp.pipe(
				fp.groupBy((key) => {
					const end = key.indexOf('/', prefix.length)
					return key.slice(0, end === -1 ? undefined : end)
				}),
				fp.toPairs,
				fp.map(([ key, values ]) => this._stat(key, values)),
			)(keys))
		return list.filter(Boolean)
	}

	chdir (path = '.') {
		const key = this._toKey(path)
		const clientPath = `/${key}`
		this._cwd = clientPath
		return this.currentDirectory()
	}

	async write (fileName, options = {}) {
		const {
			append = false,
			start = undefined,
		} = options
		const key = this._toKey(fileName)

		const chunks = []
		if (append || start) {
			const entry = await this._core.get(key)
			if (!entry) { throw new Error("not found") }
			const chunk = append ? entry.value : entry.value.slice(start)
			chunks.push(chunk)
		}

		const stream = new Stream.PassThrough()
		stream
			.on('data', (chunk) => {
				chunks.push(chunk)
			})
			.on('end', async () => {
				const data = Buffer.concat(chunks)
				await this._core.set(key, data)
			})

		const clientPath = `/${key}`

		return {
			stream,
			clientPath,
		}
	}

	async read (fileName, options = {}) {
		const { start } = options
		const key = this._toKey(fileName)
		const entry = await this._core.get(key)
		if (!entry) { throw new Error("not found") }

		const data = entry.value.slice(start)
		const stream = Stream.Readable.from(data)
		const clientPath = `/${key}`

		return {
			stream,
			clientPath,
		}
	}

	async delete (path) {
		const prefix = this._toKey(path)
		const keys = await this._prefix(prefix)
		await Promise.all(keys.map((key) => this._core.set(key, null)))
	}

	mkdir () {}

	async rename (from, to) {
		const fromPrefix = this._toKey(from)
		const toPrefix = this._toKey(to)

		const fromKeys = await this._prefix(fromPrefix)
		await Promise.all(fromKeys.map(async (fromKey) => {
			const entry = await this._core.get(fromKey)
			if (!entry) { throw new Error("not found") }
			const toKey = fromKey.replace(fromPrefix, toPrefix)
			return Promise.all([
				this._core.set(fromKey, null),
				this._core.set(toKey, entry.value),
			])
		}))
	}

	chmod () {}
}

module.exports = (options) => {
	let core = null

	const server = new FtpSrv(options)
	server.on('login', (data, resolve) => {
		resolve({ fs: new WikiFs(core) })
	})

	const init = (_core) => {
		core = _core
	}

	const start = async () => {
		await new Promise((resolve, reject) => {
			server.listen(options.port || 80, (error) => {
				error ? reject(error) : resolve()
			})
		})
	}

	const stop = async () => {
		await new Promise((resolve, reject) => {
			server.close((error) => {
				error ? reject(error) : resolve()
			})
		})
	}

	return {
		init,
		start,
		stop,
	}
}
