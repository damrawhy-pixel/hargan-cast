import https from 'https'
import Application from '../service'

const REQUEST_TIMEOUT_MS = 20_000
const MAX_NOT_READY_RETRIES = 40

export default class Http {

    _application:Application

    constructor(application:Application) {
        this._application = application
    }

    // 204 means "not ready yet"; ask again, but never forever.
    get(host:string, url: string, method = 'GET', attempt = 0) {
        return new Promise((resolve, reject) => {
            let responseData = ''

            const req = https.request({
                host: host,
                path: url,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
            }, (response:any) => {
                response.on('data', (data:any) => {
                    responseData += data
                })

                response.on('end', () => {
                    if(response.statusCode >= 200 && response.statusCode <= 299){
                        this._application.log('HTTP', 'get('+url+', '+method+') resolve:', response.statusCode)
                        let returnData = responseData
                        try {
                            returnData = JSON.parse(responseData)
                        } catch(error){
                            // Data is not JSON..
                        }

                        if(response.statusCode === 204){
                            if(attempt + 1 >= MAX_NOT_READY_RETRIES){
                                reject(new Error('Sunucu yanıtı hazırlayamadı: ' + host))
                                return
                            }
                            setTimeout(() => {
                                this.get(host, url, method, attempt + 1).then((result) => {
                                    resolve(result)

                                }).catch((error) => {
                                    reject(error)
                                })
                            }, 750)
                        } else {
                            resolve(returnData)
                        }
                    } else {
                        this._application.log('HTTP', 'get('+url+') reject:', response.statusCode)
                        reject({
                            url: url,
                            status: response.statusCode,
                            body: responseData,
                        })
                    }
                })
            })

            req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Sunucu yanıt vermedi: ' + host)))
            req.on('error', (error) => {
                reject(error)
            })
            req.end()
        })
    }

    post(host: string, url: string, postData = {}, headers = {}) {
        return new Promise((resolve, reject) => {
            let responseData = ''
            const mergedHeaders = Object.assign({}, {
                'Content-Type': 'application/json',
            }, headers)

            const req = https.request({
                host: host,
                path: url,
                method: 'POST',
                headers: mergedHeaders,
            }, (response:any) => {

                response.on('data', (data:any) => {
                    responseData += data
                })

                response.on('end', () => {
                    if(response.statusCode >= 200 && response.statusCode <= 299){
                        this._application.log('HTTP', 'post('+url+') resolve:', response.statusCode, responseData.substring(0, 100))

                        let returnData = responseData
                        try {
                            returnData = JSON.parse(responseData)
                        } catch(error){
                            // Data is not JSON..
                        }
                        
                        resolve(returnData)
                    } else {
                        this._application.log('HTTP', 'post('+url+') reject:', response.statusCode)
                        reject({
                            url: url,
                            status: response.statusCode,
                            body: responseData,
                        })
                    }
                })
            })

            req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Sunucu yanıt vermedi: ' + host)))
            req.on('error', (error) => {
                reject(error)
            })

            req.write(JSON.stringify(postData))

            req.end()
        })
    }

}