export namespace main {
	
	export class AboutItem {
	    key: string;
	    value: string;
	    link?: string;
	
	    static createFrom(source: any = {}) {
	        return new AboutItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.link = source["link"];
	    }
	}
	export class CropBox {
	    left: number;
	    top: number;
	    right: number;
	    bottom: number;
	
	    static createFrom(source: any = {}) {
	        return new CropBox(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.left = source["left"];
	        this.top = source["top"];
	        this.right = source["right"];
	        this.bottom = source["bottom"];
	    }
	}
	export class ExtractionMetadata {
	    extractionDate: string;
	    pdfPath: string;
	    cropBox: CropBox;
	    totalPages: number;
	    appVersion?: string;
	
	    static createFrom(source: any = {}) {
	        return new ExtractionMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.extractionDate = source["extractionDate"];
	        this.pdfPath = source["pdfPath"];
	        this.cropBox = this.convertValues(source["cropBox"], CropBox);
	        this.totalPages = source["totalPages"];
	        this.appVersion = source["appVersion"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PageData {
	    page: number;
	    text: string;
	    number?: string;
	
	    static createFrom(source: any = {}) {
	        return new PageData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.text = source["text"];
	        this.number = source["number"];
	    }
	}
	export class VersionInfo {
	    version: string;
	    versionDate: string;
	
	    static createFrom(source: any = {}) {
	        return new VersionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.versionDate = source["versionDate"];
	    }
	}

}

