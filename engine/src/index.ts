import "dotenv/config";
import { createClient } from "redis";
import { env } from "./utils/env.js";
import { BALANCES, FILLS, ORDERBOOKS, ORDERS, type CreateOrderInput, type Fill, type OrderRecord, type RestingOrder } from "./store/exchange-store.js";

export type EngineCommandType =
  | "create_order"
  | "get_depth"
  | "get_user_balance"
  | "get_order"
  | "cancel_order";

export interface EngineRequest {
  correlationId: string;
  responseQueue: string;
  type: EngineCommandType;
  payload: Record<string, unknown>;
}

export interface EngineResponse {
  correlationId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

const brokerClient = createClient({ url: env.redisUrl }).on("error", (error) => {
  console.error("Redis broker client error", error);
});

const responseClient = createClient({ url: env.redisUrl }).on("error", (error) => {
  console.error("Redis response client error", error);
});

await Promise.all([brokerClient.connect(), responseClient.connect()]);

// :-)) I added this just to check the flow, remove it when you start
const DUMMY_SELL_ORDER = {
  orderId: "dummy-sell-order-1",
  userId: "dummy-seller",
  type: "limit",
  side: "sell",
  symbol: "BTC",
  price: 100,
  qty: 1,
  filledQty: 0,
  status: "open",
};

async function sendResponse(responseQueue: string, response: EngineResponse): Promise<void> {
  await responseClient.lPush(responseQueue, JSON.stringify(response));
}

function handleEngineRequest(message: EngineRequest): unknown {
  /**
   * TODO(student):
   * 1. Check _message.type.
   * 2. Read _message.payload.
   * 3. Call your order book / balance / order logic.
   * 4. Return the data that should go back to the backend.
   *
   * Required message types:
   * - create_order
   * - get_depth
   * - get_user_balance
   * - get_order
   * - cancel_order
   */

  // just checking the flow, remove this when you start implementing the logic
  if (message.type === "create_order") {
    const {userId, type, side, symbol, price, qty} = message.payload as unknown as CreateOrderInput;
    let book = ORDERBOOKS.get(symbol);
    //if not
    if(!book){
      book = {
        asks: new Map<number,RestingOrder[]>(),
        bids: new Map<number,RestingOrder[]>()
      }
      ORDERBOOKS.set(symbol,book);
    }
    const orderId = crypto.randomUUID();
    if(type === "market"){
      if(side === "buy"){
        const sortedAsks:number[] = [...book.asks.keys()].sort((a,b)=>a - b);
        if(!sortedAsks.length){
          throw new Error("no_liquidity");
        }
        //try match
        const balance = BALANCES.get(userId);
        if(!balance){
          BALANCES.set(userId,{
            "USD":{
              available:0,
              locked:0
            }
          })
        }
        
        //get locking price
        let remainingQty = qty;
        let totalCost = 0;
        for(const askPrice of sortedAsks){
          if(remainingQty <= 0)
            break
          let ordersAtPrice = book.asks.get(askPrice);
          if(!ordersAtPrice) continue

          for(const restingOrder of ordersAtPrice){
            if(remainingQty <=0) break;

            const restingRemainingQty = restingOrder.qty - restingOrder.filledQty;
            const fillQty = Math.min(remainingQty,restingRemainingQty);

            totalCost += fillQty * askPrice;
            remainingQty -= fillQty;
          }
        }

        //check user eligibility
        const userBalances = BALANCES.get(userId);
        const usdBalance = userBalances?.USD;

        if(!usdBalance || usdBalance.available < totalCost){
          throw new Error("insufficient_balance")
        }
        
        //create market buy order
        const buyOrder:OrderRecord = {
          orderId: orderId,
          userId: userId,
          side: "buy",
          type: "market",
          symbol: symbol,
          price: null,
          qty: qty,
          filledQty: 0,
          status: "open",
          fills:[],
          createdAt: Date.now(),
        }

        // then loop again and actually:
        // - update restingOrder.filledQty
        // - create fills
        // - update seller balances
        // - remove filled resting orders
        // - save incoming order in ORDERS
        
        //actual order matching
        usdBalance.available -= totalCost;
        remainingQty = qty;
        totalCost = 0;
        let filledQty = 0;
        for(const askPrice of sortedAsks){
          if(remainingQty <= 0) break;
          let ordersAtPrice = book.asks.get(askPrice);
          if(!ordersAtPrice) continue
          
          for(const restingOrder of ordersAtPrice){
            if(remainingQty <=0) break;
            
            const restingRemainingQty = restingOrder.qty - restingOrder.filledQty;
            const fillQty = Math.min(remainingQty,restingRemainingQty);
            
            restingOrder.filledQty += fillQty;
            buyOrder.filledQty += fillQty;
            remainingQty -= fillQty;
            filledQty += fillQty;
            //updating restingOrder object
            if(restingOrder.qty === restingOrder.filledQty){
              restingOrder.status = "filled";
            } else {
              restingOrder.status = "partially_filled";
            }
            
            //creating fill and updating at all 3 places FILLS, buyerOrder.fills, sellerOrder.fills 
            const fill : Fill={
              fillId: crypto.randomUUID(),
              symbol: symbol,
              price: askPrice,
              qty: fillQty,
              buyOrderId: orderId,
              sellOrderId: restingOrder.orderId,
              createdAt: Date.now()
            }

            FILLS.push(fill);
            buyOrder.fills.push(fill);
            ORDERS.get(restingOrder.orderId)?.fills.push(fill);
          }
          
          const remainingOrdersAtPrice = ordersAtPrice.filter((order)=>
            order.filledQty < order.qty
          )
          
          if(remainingOrdersAtPrice.length === 0){
            book.asks.delete(askPrice);
          }
          else{
            book.asks.set(askPrice,remainingOrdersAtPrice);
          }
        }

        const savedOrder = ORDERS.get(orderId);
        if (savedOrder) {
          savedOrder.status = "partially_filled";
        }
      }
      else{
        const sortedBids = [...book.bids.keys()].sort((a, b) => b - a);

        if (!sortedBids.length) {
          throw new Error("no_liquidity");
        }
      }
    }
  }
  
  else if (message.type === "get_user_balance"){
    
  }

  else if(message.type === "")

  throw new Error("TODO(student): implement this engine request type");
}

console.log(`Engine listening on Redis queue: ${env.incomingQueue}`);

for (;;) {
  const item = await brokerClient.brPop(env.incomingQueue, 0);
  if (!item) continue;

  let message: EngineRequest;

  try {
    message = JSON.parse(item.element) as EngineRequest;
  } catch {
    console.error("Skipping invalid broker message");
    continue;
  }

  try {
    const data = handleEngineRequest(message);
    await sendResponse(message.responseQueue, {
      correlationId: message.correlationId,
      ok: true,
      data,
    });
  } catch (error) {
    await sendResponse(message.responseQueue, {
      correlationId: message.correlationId,
      ok: false,
      error: error instanceof Error ? error.message : "engine_error",
    });
  }
}