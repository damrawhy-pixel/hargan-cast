import Application from '../service'
import HTTP from './http'
import Store from '../secureStore'
import axios from 'axios'
import { defaultSettings } from '../settings';

interface titleInfoArgs {
    ProductTitle: string;
    PublisherName: string;
    XCloudTitleId: string;
    Image_Tile: any;
    Image_Poster: any;
    Streamability: any;
    Categories: any;
    LocalizedCategories: any;
    XCloudOfferings: any;
    XboxTitleId: string;
    ChildXboxTitleIds: any;
    StoreId: string;
}

export default class TitleManager {

    _application:Application
    _store = new Store()
    _http:HTTP

    _xCloudTitles = {}
    _productIdQueue: any[] = []

    _xCloudRecentTitles = {}
    _xCloudRecentTitlesLastUpdate = 0

    
    constructor(application){
        this._application = application
        this._http = new HTTP(this._application)
    }
    getGamePassProducts(titles) {
        return new Promise((resolve) => {
            const productIdQueue: any[] = [];
            const v2TitleMap = {};
            if (!Array.isArray(titles)) {
                resolve([]);
            }
            titles.forEach(title => {
                if (title.details && title.details.productId) {
                    productIdQueue.push(title.details.productId);
                    v2TitleMap[title.details.productId] = title;
                }
            });

            this.getCatalogGames(productIdQueue, v2TitleMap).then((titles: any) => {
                const seen = new Set()
                resolve(titles
                    .sort((x, y) => x.ProductTitle.localeCompare(y.ProductTitle))
                    .filter((item) => !seen.has(item.ProductTitle) && seen.add(item.ProductTitle)))
            })
        })
    }

    getCatalogGames(products: any[] = [], v2TitleMap: Record<string, any> = {}) {
        const settings: any = this._application._store.get(
                "settings",
                defaultSettings
            );
        const lang = settings.preferred_game_language.indexOf('zh') > -1 ? 'zh-TW' : 'en-US';
        return new Promise(resolve => {
            axios
                .post(
                    `https://catalog.gamepass.com/v3/products?market=US&language=${lang}&hydration=RemoteLowJade0`,
                    {
                    Products: [...products],
                    },
                    {
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'ms-cv': 0,
                        'calling-app-name': 'Xbox Cloud Gaming Web',
                        'calling-app-version': '24.17.63',
                    },
                    },
                )
                .then(res => {
                    console.log('POST catalog.gamepass.com/v3/products success')
                    if (res.data && res.data.Products) {
                    const products = res.data.Products;
                    let mergedTitles: any[] = [];
                    for (const key in products) {
                        if (v2TitleMap[key]) {
                        mergedTitles.push({
                            productId: key,
                            ...products[key],
                            ...v2TitleMap[key],
                        });
                        } else {
                        mergedTitles.push({
                            productId: key,
                            ...products[key],
                        });
                        }
                    }
                    mergedTitles.sort((a, b) =>
                        a.ProductTitle.localeCompare(b.ProductTitle),
                    );
                    mergedTitles = mergedTitles.filter(item => {
                        return item.titleId || item.XCloudTitleId;
                    });
                    resolve(mergedTitles);
                    } else {
                    resolve([]);
                    }
                })
                .catch(e => {
                    console.log('getGamePassProducts error:', e);
                    // reject(e);
                    resolve([])
                });
        })
    }

    getNewTitles(){
        return this._http.get('catalog.gamepass.com', '/sigls/v2?id=f13cf6b4-57e6-4459-89df-6aec18cf0538&market=US&language=en-US')
    }
}

interface TitleDetails {
    titleId:string;
    details: {
        productId:string;
        xboxTitleId:number;
        hasEntitlement:boolean;
        supportsInAppPurchases:boolean;
        supportedTabs: any;
        supportedInputTypes: any;
        programs: any;
        userPrograms: any;
        userSubscriptions: any;
        isFreeInStore: boolean;
        maxGameplayTimeInSeconds: number;
    };
}

export class Title {

    titleId
    productId
    xboxTitleId
    supportedInputTypes
    catalogDetails

    constructor(title:TitleDetails){
        this.titleId = title.titleId
        this.productId = title.details.productId
        this.xboxTitleId = title.details.xboxTitleId
        this.supportedInputTypes = title.details.supportedInputTypes
    }

    setCatalogDetails(titleInfo:titleInfoArgs){
        this.catalogDetails = titleInfo
    }

    toString(){
        return JSON.stringify(this)
    }

    restoreFromCache(cachedObj){
        this.catalogDetails = cachedObj.catalogDetails
    }
}