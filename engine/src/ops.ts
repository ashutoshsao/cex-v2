import { ORDERBOOKS, type OrderBook, type OrderRecord, type OrderStatus, type OrderType, type RestingOrder, type Side } from "./store/exchange-store";

export function getOrderBook(symbol:string):OrderBook{
    let book = ORDERBOOKS.get(symbol);
    if(!book){
        book = {
            bids:new Map(),
            asks:new Map()
        };
        ORDERBOOKS.set(symbol,book);
    }
    return book;
}

export function getRemainingQty(order:OrderRecord):number{
    return order.qty - order.filledQty;
}

export function setOrderToBook(order:RestingOrder):void{
    let book = getOrderBook(order.symbol);
    let sideMap = order.side === "buy"
        ?book.bids
        :book.asks
    let ordersByPrice = sideMap.get(order.price) ?? [];
    ordersByPrice.push(order);
    sideMap.set(order.price,ordersByPrice);
}

export function getOrderStatus(qty:number,filledQty:number):OrderStatus{
    if(qty === 0 ) return "open";
    else if(filledQty < qty) return "partially_filled";
    else return "filled";
}

export function getSortedOrdersByPrice(incommingSide:Side,prices:number[]):number[]{
    if(incommingSide === "buy"){
        return prices.sort((a,b) => a - b);
    }
    return prices.sort((a,b) => b - a);
}

export function canMatch(incommingside:Side,incommingPrice:number,restingPrice:number,orderType:OrderType):boolean{
    if(orderType === "market") return true;
    if(incommingPrice === null) return false;
    if(incommingside === "buy") {
        return incommingPrice >= restingPrice;
    }
    return incommingPrice <= restingPrice;
}