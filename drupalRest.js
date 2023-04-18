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
  file: {
    entityHandle: 'entity/file/%',
    idField: 'fid'
  },
  paragraph: {
    entityHandle: 'entity/paragraph/%',
    createHandle: 'entity/paragraph',
    idField: 'pid'
  },
  user: {
    entityHandle: 'user/%',
    createHandle: 'entity/user',
    idField: 'uid'
  }
}

class DrupalREST {
  /**
   * @param {Object} options - Options to the API
   * @param {string} options.url - URL of the Drupal installation
   * @param {string} [options.user] - Username to login (if empty, use anonymous access)
   * @param {string} [options.pass] - Password to login
   */
  constructor (options) {
    this.options = options
    this.sessionHeaders = {}
  }

  /**
   * Login to website for further requests
   * @param {function} callback
   */
  login (callback) {
    if (!this.options.user) {
      // anonymous access
      return callback(null)
    }

    fetch(this.options.url + '/user/login?_format=json', {
      method: 'POST',
      header: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: this.options.user,
        pass: this.options.pass
      })
    })
      .then(req => {
        if (req.headers.has('Set-Cookie')) {
          const cookie = req.headers.get('Set-Cookie').split(/;/g)[0]
          this.sessionHeaders.Cookie = cookie
        }
        return req.text()
      })
      .then(body => this.processJSONResult(body, (err, data) => {
        if (err) { return callback(err) }

        this.sessionHeaders['X-CSRF-Token'] = data.csrf_token
        callback(null)
      }))
  }

  /**
   * Load a path in the drupal.
   * @param {string} path - Path within drupal, e.g. 'node/1'
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err, content)
   */
  get (path, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    const url = this.options.url + '/' + path

    fetch(url, {
      headers: this.sessionHeaders
    })
      .then(req => req.text())
      .then(body => {
        global.setTimeout(() => callback(null, body), 0)
      })
      .catch(error => {
        global.setTimeout(() => callback(error), 0)
      })
  }

  entityGet (entityType, id, options, callback) {
    const def = entityConfiguration[entityType]
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    const url = this.options.url + '/' + def.entityHandle.replace('%', id)
    fetch(url + '?_format=json', {
      headers: this.sessionHeaders
    })
      .then(req => req.text())
      .then(body => this.processJSONResult(body, (err, result) => {
        if (err) { return callback(err) }

        this._entityLoad(result, options, callback)
      }))
      .catch(error => {
        global.setTimeout(() => callback(error), 0)
      })
  }

  _entityLoad (result, options, callback) {
    async.each(options.includeReferences, (fieldId, done) => {
      async.eachOf(result[fieldId], (value, index, done) => {
        this.entityGet(value.target_type, value.target_id, (err, data) => {
          if (err) { return done(err) }
          result[fieldId][index].data = data
          done()
        })
      }, done)
    }, (err) => callback(err, result))
  }

  entitySave (entityType, id, content, options, callback) {
    const def = entityConfiguration[entityType]
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    async.eachOf(
      content,
      (a, key, done) => async.eachOfSeries(a, (value, index, done) => {
        if (value.data) {
          if (value.target_type === 'fileUpload') {
            this.fileUpload(value.data, [entityType, content.type[0].target_id, key].join('/'), {},
              (err, result) => {
                if (err) { return done(err) }
                content[key][index].target_id = result.fid[0].value
                done()
              }
            )
          } else {
            const childDef = entityConfiguration[value.target_type]

            //value.data.parent_id = 

            this.entitySave(value.target_type, value.target_id, value.data,
              (err, result) => {
                if (err) { return done(err) }
                content[key][index].target_id = result[childDef.idField][0].value
                done()
              }
            )
          }
        }
        else {
          done()
        }
      }, done),
      (err) => {
        if (err) { return callback(err) }
        console.log(content)

        const url = this.options.url + '/' + (id ? def.entityHandle.replace('%', id) : def.createHandle)
        fetch(url + '?_format=json', {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(content),
          headers: {
            'Content-Type': 'application/json',
            ...this.sessionHeaders
          }
        })
          .then(req => req.text())
          .then(body => this.processJSONResult(body, callback))
          .catch(error => {
            console.error('saving ' + entityType + '/' + id + ':', error)
            global.setTimeout(() => callback(error), 0)
          })
      }
    )
  }

  entityRemove (entityType, id, options, callback) {
    const def = entityConfiguration[entityType]
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    const url = this.options.url + '/' + def.entityHandle.replace('%', id)
    fetch(url + '?_format=json', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...this.sessionHeaders
      }
    })
      .then(req => req.text())
      .then(body => {
        if (body === '') {
          return global.setTimeout(() => callback(null), 0)
        }

        this.processJSONResult(body, callback)
      })
      .catch(error => {
        console.error('deleting ' + entityType + '/' + id + ':', error)
        global.setTimeout(() => callback(error), 0)
      })
  }

  /**
   * Load the JSON structure for a node
   * @param {number} id - ID of the node
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {string[]} [options.includeReferences] - For the listed fields, load referenced content into the 'data' attribute.
   * @param {function} callback - The callback will receive (err, content)
   */
  nodeGet (id, options, callback) {
    this.entityGet('node', id, options, callback)
  }

  /**
   * Create a node or change an existing node
   * @param {number|null} id - ID of the node or null to create a new node
   * @param {Object} content - Content to save
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err, content)
   */
  nodeSave (id, content, options, callback) {
    this.entitySave('node', id, content, options, callback)
  }

  /**
   * Remove a node
   * @param {number} id - ID of the node
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err). If err is null, the node has been successfully removed.
   */
  nodeRemove (id, options, callback) {
    this.entityRemove('node', id, options, callback)
  }

  /**
   * Upload a file
   * @param {Object} file - A structure describing the file
   * @param {string} file.filename - Filename of the file
   * @param {*} [file.content] - Content of the file (whatever fetch accepts, e.g. string, Blob, ...)
   * @param {string} [file.src] - Source of the file. If content is not set, download the file from there.
   * @param {string} entityPath - '{entity_type_id}/{type_id}/{field_id}', e.g. 'media/image/field_media_image'.
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err, file)
   */
  fileUpload (file, entityPath, options, callback) {
    const headers = { ...this.sessionHeaders }
    headers['Content-Type'] = 'application/octet-stream'
    headers['Content-Disposition'] = 'file; filename="' + file.filename + '"'

    if (!file.content) {
      if (file.src) {
        return fetch(file.src)
          .then(req => req.blob())
          .then(body => {
            file.content = body
            this.fileUpload(file, entityPath, options, callback)
          })
      }
    }

    fetch(this.options.url + '/file/upload/' + entityPath + '?_format=json', {
      method: 'post',
      body: file.content,
      headers
    })
      .then(req => req.text())
      .then(body => this.processJSONResult(body, callback))
      .catch(error => {
        console.error('uploading ' + entityPath + ':', error)
        global.setTimeout(() => callback(error), 0)
      })
  }

  /**
   * Load the JSON structure for a taxonomy term
   * @param {number} id - ID of the taxonomy term
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {string[]} [options.includeReferences] - For the listed fields, load referenced content into the 'data' attribute.
   * @param {function} callback - The callback will receive (err, content)
   */
  taxonomyGet (id, options, callback) {
    this.entityGet('taxonomy', id, options, callback)
  }

  /**
   * Create a node or change an existing taxonomy term
   * @param {number|null} id - ID of the node or null to create a new node
   * @param {Object} content - Content to save
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err, content)
   */
  taxonomySave (id, content, options, callback) {
    this.entitySave('taxonomy', id, content, options, callback)
  }

  /**
   * Remove a taxonomy term
   * @param {number} id - ID of the taxonomy term
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err). If err is null, the taxonomy term has been successfully removed.
   */
  taxonomyRemove (id, options, callback) {
    this.entityRemove('taxonomy', id, options, callback)
  }

  /**
   * Load the JSON structure for a media entity
   * @param {number} id - ID of the media entity
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {string[]} [options.includeReferences] - For the listed fields, load referenced content into the 'data' attribute.
   * @param {function} callback - The callback will receive (err, content)
   */
  mediaGet (id, options, callback) {
    this.entityGet('media', id, options, callback)
  }

  /**
   * Create a media entity or change an existing media entity
   * @param {number|null} id - ID of the media entity or null to create a new media entity
   * @param {Object} content - Content to save
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err, content)
   */
  mediaSave (id, content, options, callback) {
    this.entitySave('media', id, content, options, callback)
  }

  /**
   * Remove a media entity
   * @param {number} id - ID of the media entity
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err). If err is null, the media entity has been successfully removed.
   */
  mediaRemove (id, options, callback) {
    this.entityRemove('media', id, options, callback)
  }

  /**
   * Load the JSON structure for a user
   * @param {number} id - ID of the user
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {string[]} [options.includeReferences] - For the listed fields, load referenced content into the 'data' attribute.
   * @param {function} callback - The callback will receive (err, content)
   */
  userGet (id, options, callback) {
    this.entityGet('user', id, options, callback)
  }

  /**
   * Create a user or change an existing user
   * @param {number|null} id - ID of the user or null to create a new user
   * @param {Object} content - The content to save
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err, content)
   */
  userSave (id, content, options, callback) {
    this.entitySave('user', id, content, options, callback)
  }

  /**
   * Remove a user
   * @param {number} id - ID of the user
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err). If err is null, the user has been successfully removed.
   */
  userRemove (id, options, callback) {
    this.entityRemove('user', id, options, callback)
  }

  /**
   * Load the JSON structure for a file entity
   * @param {number} id - ID of the file
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {string[]} [options.includeReferences] - For the listed fields, load referenced content into the 'data' attribute.
   * @param {function} callback - The callback will receive (err, content)
   */
  fileGet (id, options, callback) {
    this.entityGet('file', id, options, callback)
  }

  /**
   * Change an existing file
   * @param {number} id - ID of the file
   * @param {Object} content - The content to change
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err, content)
   */
  fileSave (id, content, options, callback) {
    this.entitySave('file', id, content, options, callback)
  }

  /**
   * Remove a file
   * @param {number} id - ID of the file
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err). If err is null, the file has been successfully removed.
   */
  fileRemove (id, options, callback) {
    this.entityRemove('file', id, options, callback)
  }

  /**
   * Load the JSON structure for a paragraph entity
   * @param {number} id - ID of the paragraph
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {string[]} [options.includeReferences] - For the listed fields, load referenced content into the 'data' attribute.
   * @param {function} callback - The callback will receive (err, content)
   */
  paragraphGet (id, options, callback) {
    this.entityGet('paragraph', id, options, callback)
  }

  /**
   * Change an existing paragraph
   * @param {number} id - ID of the paragraph
   * @param {Object} content - The content to change
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err, content)
   */
  paragraphSave (id, content, options, callback) {
    this.entitySave('paragraph', id, content, options, callback)
  }

  /**
   * Remove a paragraph
   * @param {number} id - ID of the paragraph
   * @param {Object} [options] - Additional options (currently none defined)
   * @param {function} callback - The callback will receive (err). If err is null, the paragraph has been successfully removed.
   */
  paragraphRemove (id, options, callback) {
    this.entityRemove('paragraph', id, options, callback)
  }

  /**
   * Load a REST export
   * @param {string} path - The path of the REST view
   * @param {Object} options - Options
   * @param {boolean} [options.paginated=true] - If true, keep retrieving all pages of the view, until an empty result is returned.
   * @param {number} [options.startPage=0] - Starting page
   * @param {number} [options.endPage=null] - Load until page n has been reached (including this page). If null, do not stop loading.
   * @param {function} [options.each] - A function which will be called for every item as soon as it is loaded. Called with (item, index).
   * @param {string[]} [options.includeReferences] - For the listed fields, load referenced content into the 'data' attribute.
   * @param {function} callback - The callback will receive (err, list). List is an array of all results.
   */
  loadRestExport (path, options, callback) {
    if (!('paginated' in options)) {
      options.paginated = true
    }

    const sep = path.includes('?') ? '&' : '?'
    let page = options.startPage || 0
    let endPage = options.endPage || null
    if (options.paginated === false) {
      endPage = page
    }
    let notDone = true
    let result = []

    async.doWhilst(
      (callback) => {
        if (endPage !== null && page > endPage) {
          notDone = false
          return callback()
        }

        fetch(this.options.url + '/' + path + sep + 'page=' + page + '&_format=json', {
          headers: this.sessionHeaders
        })
          .then(req => req.json())
          .then(data => {
            if (data.length === 0) {
              notDone = false
            }

            page++

            async.eachOfSeries(data, (item, i, done) => {
              this._entityLoad(item, options,
                (err, item) => {
                  if (err) { return done(err) }

                  if (options.each) {
                    options.each(item, i + result.length)
                  }

                  done()
                }
              )
            }, (err) => {
              if (err) { return callback(err) }

              result = result.concat(data)

              callback()
            })
          })
          .catch(error => {
            console.error('loading rest export ' + path + ':', error)
            callback(error)
          })
      },
      (callback) => callback(null, notDone),
      (err) => callback(err, result)
    )
  }

  processJSONResult (body, callback) {
    let data = null
    let error = null
    try {
      data = JSON.parse(body)
    } catch (e) {
      error = new Error(body)
    }

    if (data && 'message' in data) {
      error = new Error(data.message)
      data = null
    }

    global.setTimeout(() => callback(error, data), 0)
  }
}

module.exports = DrupalREST
