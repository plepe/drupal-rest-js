const async = require('async')

const entityConfiguration = {
  node: {
    entityHandle: 'node/%',
    createHandle: 'node',
    idField: 'nid'
  },
  media: {
    entityHandle: 'media/%/edit',
    createHandle: 'entity/media',
    idField: 'mid'
  },
  taxonomy: {
    entityHandle: 'taxonomy/term/%',
    createHandle: 'taxonomy/term',
    idField: 'tid'
  },
  user: {
    entityHandle: 'user/%',
    createHandle: 'entity/user',
    idField: 'uid'
  }
}

module.exports = class DrupalREST {
  constructor (options) {
    this.options = options
    this.sessionHeaders = {}
  }

  login (callback) {
    fetch(this.options.url + '/user/login?_format=json', {
      method: 'POST',
      header: {
	'Content-Type': 'application/json',
      },
      body: JSON.stringify({
	name: this.options.user,
	pass: this.options.pass,
      })
    })
      .then(req => {
	if (req.headers.has('Set-Cookie')) {
	  const cookie = req.headers.get('Set-Cookie').split(/;/g)[0]
	  this.sessionHeaders['Cookie'] = cookie
	}
	return req.json()
      })
      .then(data => {
	this.sessionHeaders['X-CSRF-Token'] = data.csrf_token
	callback(null)
      })
  }

  entityGet (entityType, id, options, callback) {
    const def = entityConfiguration[entityType]

    fetch(this.options.url + '/' + def.entityHandle + '/' + id + '?_format=json', {
      headers: this.sessionHeaders
    })
      .then(req => req.json())
      .then(data => callback(null, data))
  }

  entitySave (entityType, id, content, options, callback) {
    const def = entityConfiguration[entityType]

    const url = this.options.url + '/' + (id ? def.entityHandle + '/' : def.createHandle)
    fetch(url + '?_format=json', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(content),
      headers: {
	'Content-Type': 'application/json',
	...this.sessionHeaders
      }
    })
      .then(req => req.json())
      .then(data => callback(null, data))
  }

  nodeGet (id, options, callback) {
    this.entityGet('node', id, options, callback)
  }

  nodeSave (id, content, options, callback) {
    this.entitySave('node', id, content, options, callback)
  }


  fileUpload (file, entityPath, options, callback) {
    const headers = { ...this.sessionHeaders }
    headers['Content-Type'] = 'application/octet-stream'
    headers['Content-Disposition'] = 'file; filename="' + file.filename + '"'

    fetch(this.options.url + '/file/upload/' + entityPath + '?_format=json', {
      method: 'post',
      body: file.content,
      headers
    })
      .then(req => req.json())
      .then(data => callback(null, data))
  }

  taxonomyGet (id, options, callback) {
    this.entityGet('taxonomy', id, options, callback)
  }

  taxonomySave (id, content, options, callback) {
    this.entitySave('taxonomy', id, content, options, callback)
  }

  mediaGet (id, options, callback) {
    this.entityGet('media', id, options, callback)
  }

  mediaSave (id, content, options, callback) {
    this.entitySave('media', id, content, options, callback)
  }

  userGet (id, options, callback) {
    this.entityGet('user', id, options, callback)
  }

  userSave (id, content, options, callback) {
    this.entitySave('user', id, content, options, callback)
  }

  loadRestExport (path, options, callback) {
    if (!('paginated' in options)) {
      options.paginated = true
    }

    const sep = path.includes('?') ? '&' : '?'
    let page = 0
    let notDone = true
    let result = []

    async.doWhilst(
      (callback) => {
	fetch(this.options.url + '/' + path + sep + 'page=' + page + '&_format=json', {
	  headers: this.sessionHeaders
	})
	  .then(req => req.json())
	  .then(data => {
	    if (data.length === 0) {
	      notDone = false
	    }

	    page++
	    result = result.concat(data)
	    callback()
	  })
      },
      (callback) => callback(null, notDone),
      (err) => callback(null, result)
    )
  }
}
