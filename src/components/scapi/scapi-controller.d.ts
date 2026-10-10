export const SCAPI_STATES: readonly string[];
export interface Controller {setState(state:string):void;setGaze(gaze:string):void;setReducedMotion(value:boolean):void;setEffects(value:boolean):void;setSpeed(value:number):void;getSnapshot():{ready:boolean;state:string;gaze:string;reducedMotion:boolean;running:boolean;pose:Record<string,number>};destroy():void;}
export function createScapi(canvas:HTMLCanvasElement,options?:{assetUrl?:string;state?:string;gaze?:string;reducedMotion?:boolean;effects?:boolean;onReady?:()=>void;onError?:(error:Error)=>void}):Controller;
