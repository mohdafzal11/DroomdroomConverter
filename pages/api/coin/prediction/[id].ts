import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { redisHandler } from 'utils/redis';
import { format, addMonths, getMonth, getYear } from 'date-fns';
import { getApiUrl } from 'utils/config';

// Technical Analysis Indicator Functions
const calculateSMA = (prices: number[], period: number): number[] => {
    const sma: number[] = [];
    for (let i = 0; i < prices.length; i++) {
        if (i < period - 1) {
            sma.push(NaN);
            continue;
        }
        const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        sma.push(sum / period);
    }
    return sma;
};

const calculateRSI = (prices: number[], period: number = 14): number[] => {
    const rsi: number[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    // Calculate price changes
    for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        gains.push(Math.max(0, change));
        losses.push(Math.max(0, -change));
    }

    // Calculate average gains and losses
    for (let i = 0; i < prices.length; i++) {
        if (i < period) {
            rsi.push(NaN);
            continue;
        }

        const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
        const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;

        if (avgLoss === 0) {
            rsi.push(100);
        } else {
            const rs = avgGain / avgLoss;
            rsi.push(100 - (100 / (1 + rs)));
        }
    }

    return rsi;
};

const calculateMACD = (prices: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): { macd: number[], signal: number[], histogram: number[] } => {
    const ema = (data: number[], period: number): number[] => {
        const k = 2 / (period + 1);
        const ema: number[] = [];
        let prevEma = data[0];

        for (let i = 0; i < data.length; i++) {
            if (i === 0) {
                ema.push(data[0]);
                continue;
            }
            prevEma = (data[i] * k) + (prevEma * (1 - k));
            ema.push(prevEma);
        }
        return ema;
    };

    const fastEMA = ema(prices, fastPeriod);
    const slowEMA = ema(prices, slowPeriod);
    const macd: number[] = fastEMA.map((fast, i) => fast - slowEMA[i]);
    const signal = ema(macd, signalPeriod);
    const histogram = macd.map((value, i) => value - signal[i]);

    return { macd, signal, histogram };
};

const calculateBollingerBands = (prices: number[], period: number = 20, multiplier: number = 2): { upper: number[], middle: number[], lower: number[] } => {
    const middle = calculateSMA(prices, period);
    const upper: number[] = [];
    const lower: number[] = [];

    for (let i = 0; i < prices.length; i++) {
        if (i < period - 1) {
            upper.push(NaN);
            lower.push(NaN);
            continue;
        }

        const slice = prices.slice(i - period + 1, i + 1);
        const stdDev = Math.sqrt(slice.reduce((sum, x) => sum + Math.pow(x - middle[i], 2), 0) / period);
        upper.push(middle[i] + (multiplier * stdDev));
        lower.push(middle[i] - (multiplier * stdDev));
    }

    return { upper, middle, lower };
};

const findSupportResistanceLevels = (prices: number[], period: number = 20): { support: number[], resistance: number[] } => {
    const support: number[] = [];
    const resistance: number[] = [];
    
    for (let i = period; i < prices.length - period; i++) {
        const windowPrices = prices.slice(i - period, i + period);
        const currentPrice = prices[i];
        
        // Check if current price is a local minimum (support)
        if (currentPrice <= Math.min(...windowPrices)) {
            support.push(currentPrice);
        }
        
        // Check if current price is a local maximum (resistance)
        if (currentPrice >= Math.max(...windowPrices)) {
            resistance.push(currentPrice);
        }
    }
    
    return { support, resistance };
};

const calculateVolatility = (prices: number[], period: number = 20): number => {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility
};

const calculateMarketSentiment = (data: {
    rsi: number,
    macdHistogram: number,
    priceChange24h: number,
    volume24hChange: number
}): { score: number, sentiment: string } => {
    let score = 50; // Neutral starting point
    
    // RSI contribution (-20 to +20)
    if (data.rsi > 70) score -= 20;
    else if (data.rsi < 30) score += 20;
    else score += ((data.rsi - 50) / 20) * 10;
    
    // MACD contribution (-15 to +15)
    score += Math.min(Math.max(data.macdHistogram * 100, -15), 15);
    
    // 24h price change contribution (-10 to +10)
    score += Math.min(Math.max(data.priceChange24h * 2, -10), 10);
    
    // Volume change contribution (-5 to +5)
    score += Math.min(Math.max(data.volume24hChange / 20, -5), 5);
    
    // Ensure score stays within 0-100 range
    score = Math.min(Math.max(score, 0), 100);
    
    // Determine sentiment category
    let sentiment: string;
    if (score >= 75) sentiment = "Very Bullish";
    else if (score >= 60) sentiment = "Bullish";
    else if (score >= 40) sentiment = "Neutral";
    else if (score >= 25) sentiment = "Bearish";
    else sentiment = "Very Bearish";
    
    return { score, sentiment };
};

interface PredictionResult {
    price: number;
    minPrice: number;
    maxPrice: number;
    roi: number;
    confidence: number;
    sentiment: string;
}

const calculatePricePrediction = (prices: number[], volumes: number[], currentPrice: number, targetDate: Date): PredictionResult => {
  // Calculate technical indicators for reference (these will still be used for shorter predictions)
    const rsi = calculateRSI(prices);
    const { macd, signal, histogram } = calculateMACD(prices);
    const { upper, middle, lower } = calculateBollingerBands(prices);
    const { support, resistance } = findSupportResistanceLevels(prices);
    const volatility = calculateVolatility(prices);

    // Calculate market sentiment with a bullish bias
    const priceChange24h = (prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2];
    const volume24hChange = (volumes[volumes.length - 1] - volumes[volumes.length - 2]) / volumes[volumes.length - 2];
    
    // Apply a stronger bullish bias to the sentiment calculation
  const bullishBias = 0.25; // 25% bullish bias
    const sentiment = calculateMarketSentiment({
      rsi: Math.min(75, rsi[rsi.length - 1] + 15),
      macdHistogram: histogram[histogram.length - 1] < -0.3 ? histogram[histogram.length - 1] : Math.max(0.1, histogram[histogram.length - 1] + 0.05),
      priceChange24h: priceChange24h < -0.15 ? priceChange24h : Math.max(0.02, priceChange24h + bullishBias),
      volume24hChange: volume24hChange + bullishBias * 1.5
    });

    // Calculate time factor (longer predictions have more uncertainty)
    const daysToTarget = Math.floor((targetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    const yearsToTarget = daysToTarget / 365;
    const timeFactor = Math.min(1, 365 / Math.max(daysToTarget, 1));
    
  // Determine if we should use monthly predictions or calculate directly
  // For predictions less than 14 days, use the existing algorithm
  // For predictions 14+ days, find the closest month in yearlyPredictions
  if (daysToTarget >= 14) {
      // We'll need to generate yearlyPredictions first in actual implementation
      // For now, we'll simulate returning a prediction based on the target date month
      
      // This could leverage the existing yearlyPredictions data or pre-generate it
      // For the implementation, we'd use:
      // const currentYear = new Date().getFullYear();
      // const yearlyPreds = generateYearlyPredictions(currentPrice, historicalVolatility, marketCap, currentYear);
      
      // Then find the closest month/year to targetDate
      // Use the price, minPrice, maxPrice, roi, etc. from that prediction
      
      // Simulated values (would be from yearlyPredictions)
      const targetYear = targetDate.getFullYear();
      const targetMonth = targetDate.getMonth();
      
      // Calculate a simulated ROI that grows based on time (just for example)
      // In real implementation, this would come from yearlyPredictions
      const monthsFromNow = (targetYear - new Date().getFullYear()) * 12 + (targetMonth - new Date().getMonth());
      const simulatedRoi = monthsFromNow * 10; // 10% growth per month as example
      
      // Calculate price based on ROI
      const price = currentPrice * (1 + (simulatedRoi / 100));
      
      // Maintain volatility-based price range
      const volatilityFactor = Math.min(30, volatility * (1 + monthsFromNow / 10));
      const minPrice = price * (1 - volatilityFactor / 100);
      const maxPrice = price * (1 + volatilityFactor / 100);
      
      // Confidence decreases over time
      const confidence = Math.max(60, 95 - (monthsFromNow * 0.5));
      
        return {
          price,
            minPrice,
            maxPrice,
          roi: simulatedRoi,
          confidence,
            sentiment: sentiment.sentiment
        };
    }
    
  // Continue with the original algorithm for short-term predictions
    // Base prediction using technical indicators
    const latestSMA = middle[middle.length - 1];
    const latestUpper = upper[upper.length - 1];
    const latestLower = lower[lower.length - 1];
    
    // Calculate trend strength with a stronger bullish bias
  const macdTrend = histogram[histogram.length - 1] < -0.25 ? -0.3 : 1.2;
  const rsiTrend = rsi[rsi.length - 1] < 35 ? -0.3 : 1.2;
    const trendStrength = (macdTrend + rsiTrend) / 2;
    
    // Apply a stronger bullish floor to trend strength unless extremely bearish indicators
    const isSeverelyBearish = rsi[rsi.length - 1] < 25 && histogram[histogram.length - 1] < -0.3 && priceChange24h < -0.15;
    const adjustedTrendStrength = isSeverelyBearish ? trendStrength : Math.max(0.25, trendStrength);

    // Calculate predicted price range
    const range = latestUpper - latestLower;
    const volatilityAdjustment = volatility * Math.sqrt(daysToTarget / 365);
    
    // Base prediction on current price and adjust based on indicators with bullish bias
    let predictedPrice = currentPrice * (1 + (adjustedTrendStrength * volatilityAdjustment));
    
    // Add a stronger time-based bullish bias for longer-term predictions
  const longTermBullishBias = Math.min(0.35, daysToTarget / 365 * 0.4);
    
    // Apply a base bullish bias to all predictions unless severely bearish
  const baseBullishBias = isSeverelyBearish ? 0 : 0.1;
    
    // Apply both biases if we're not in a severely bearish condition
    if (!isSeverelyBearish) {
        predictedPrice = predictedPrice * (1 + baseBullishBias + longTermBullishBias);
    }
    
  // Ensure predicted price doesn't go below a minimum threshold
    const minimumPriceThreshold = currentPrice * 0.1;
    predictedPrice = Math.max(predictedPrice, minimumPriceThreshold);
    
    // Calculate min and max prices, ensuring they don't go below zero
    let minPrice = Math.max(predictedPrice * (1 - volatilityAdjustment * 1.5), currentPrice * 0.05);
    let maxPrice = predictedPrice * (1 + volatilityAdjustment * 1.5);
    
    // Adjust based on support/resistance levels
    const nearestSupport = support.length > 0 ? 
        support.reduce((prev, curr) => Math.abs(curr - predictedPrice) < Math.abs(prev - predictedPrice) ? curr : prev, support[0]) : 
        currentPrice * 0.8;
    
    const nearestResistance = resistance.length > 0 ? 
        resistance.reduce((prev, curr) => Math.abs(curr - predictedPrice) < Math.abs(prev - predictedPrice) ? curr : prev, resistance[0]) : 
        currentPrice * 1.2;

    // Fine-tune prediction based on support/resistance
    if (predictedPrice < nearestSupport) predictedPrice = (predictedPrice + nearestSupport) / 2;
    if (predictedPrice > nearestResistance) predictedPrice = (predictedPrice + nearestResistance) / 2;

    // Calculate ROI
    const roi = ((predictedPrice - currentPrice) / currentPrice) * 100;

  // Calculate confidence score with a bullish bias
    const confidenceBias = predictedPrice > currentPrice ? 10 : -5;
    const confidence = Math.max(0, Math.min(100, (
      (sentiment.score * 0.3) +
      (timeFactor * 40) +
      ((1 - volatilityAdjustment) * 30) +
      confidenceBias
    )));

    return {
        price: predictedPrice,
        minPrice,
        maxPrice,
        roi,
        confidence,
        sentiment: sentiment.sentiment
    };
};


// Add these interfaces
interface MonthlyPrediction {
  month: string;
  year: number;
  price: number;
  minPrice: number;
  maxPrice: number;
  roi: number;
  sentiment: string;
  marketPhase: string;
  confidence: number;
  description?: string;
  bullishScenario?: string;
  bearishScenario?: string;
}

interface YearlyPredictions {
  [year: number]: MonthlyPrediction[];
}

// Improved helper functions for monthly contexts
const getQuarterInfo = (monthIdx: number) => {
  if (monthIdx <= 2) return { quarter: "Q1", description: "first quarter" };
  if (monthIdx <= 5) return { quarter: "Q2", description: "second quarter" };
  if (monthIdx <= 8) return { quarter: "Q3", description: "third quarter" };
  return { quarter: "Q4", description: "fourth quarter" };
};

const getMonthContext = (monthIndex: number) => {
  const monthContexts: {[key: number]: {event: string, market: string, seasonal: string}} = {
    0: { // January
      event: "the beginning of the year",
      market: "post-holiday trading patterns",
      seasonal: "typically a month of portfolio repositioning"
    },
    1: { // February
      event: "early Q1 earnings season",
      market: "evolving Q1 market sentiment",
      seasonal: "often shows consolidation after January moves"
    },
    2: { // March
      event: "the end of Q1",
      market: "fiscal quarter-end institutional flows",
      seasonal: "historically a transition month with mixed volatility"
    },
    3: { // April
      event: "Q1 earnings results",
      market: "beginning of Q2 positioning",
      seasonal: "traditionally a period of renewed market activity"
    },
    4: { // May
      event: "mid-quarter economic reports",
      market: "evolving Q2 trends",
      seasonal: "often marks directional clarity after Q1 uncertainty"
    },
    5: { // June
      event: "mid-year portfolio rebalancing",
      market: "end of Q2 adjustments",
      seasonal: "frequently displays pre-summer positioning activity"
    },
    6: { // July
      event: "Q2 earnings season",
      market: "beginning of Q3 trading patterns",
      seasonal: "often shows decreased volatility with summer trading volumes"
    },
    7: { // August
      event: "late summer market activity",
      market: "traditionally thinner liquidity conditions",
      seasonal: "historically a period of range-bound trading"
    },
    8: { // September
      event: "end of Q3 positioning",
      market: "pre-Q4 adjustments",
      seasonal: "typically exhibits increased volatility"
    },
    9: { // October
      event: "Q3 earnings reports",
      market: "beginning of Q4 strategies",
      seasonal: "often marks a pivot month for yearly trends"
    },
    10: { // November
      event: "pre-holiday market positioning",
      market: "early holiday season trading patterns",
      seasonal: "traditionally a period of trend continuation"
    },
    11: { // December
      event: "year-end portfolio adjustments",
      market: "reduced holiday trading volumes",
      seasonal: "typically marked by tax-related positioning and window dressing"
    }
  };
  
  return monthContexts[monthIndex] || monthContexts[0];
};

const getYearContext = (year: number): string => {
  const yearSpecificFactors: {[key: number]: string} = {
    2025: "the post-ETF adoption phase",
    2026: "the post-halving market cycle",
    2027: "the maturing digital asset ecosystem",
    2028: "the pre-halving anticipation period",
    2030: "the established institutional framework"
  };
  
  return yearSpecificFactors[year] || "ongoing market evolution";
};

const generateBullishScenario = (
  coinName: string,
  monthIndex: number,
  year: number,
  minPrice: number,
  maxPrice: number,
  avgPrice: number,
  roi: number,
  confidence: number,
  currentPrice: number
): string => {
  const monthlyContext = getMonthContext(monthIndex);
  const quarterInfo = getQuarterInfo(monthIndex);
  const yearContext = getYearContext(year);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = months[monthIndex];
  
  // Format prices for display
  const formatPrice = (price: number): string => {
    if (price < 0.0001) return price.toFixed(8);
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    if (price < 100) return price.toFixed(2);
    return price.toLocaleString(undefined, {maximumFractionDigits: 0});
  };

  // Define ROI description based on percentage ranges
  const getRoiDescription = (roi: number): string => {
    if (roi > 35) return `substantial return (${roi.toFixed(2)}%)`;
    if (roi >= 15) return `significant return (${roi.toFixed(2)}%)`;
    if (roi > 0) return `positive potential return (${roi.toFixed(2)}%)`;
    if (roi === 0) return `neutral return`;
    if (roi >= -5) return `slightly negative return (${roi.toFixed(2)}%)`;
    if (roi >= -10) return `moderately negative return (${roi.toFixed(2)}%)`;
    return `significantly negative return (${roi.toFixed(2)}%)`;
  };

  // Define gain/decline description based on percentage ranges
  const getGainDescription = (roi: number): string => {
    if (roi > 25) return `an impressive gain (${roi.toFixed(2)}%)`;
    if (roi >= 10) return `a significant surge (${roi.toFixed(2)}%)`;
    if (roi > 0) return `a slight gain (${roi.toFixed(2)}%)`;
    if (roi >= -5) return `a slight decline (${roi.toFixed(2)}%)`;
    if (roi >= -20) return `a notable decline (${roi.toFixed(2)}%)`;
    return `a terrifying decline (${roi.toFixed(2)}%)`;
  };

  // Define confidence level description
  const getConfidenceDescription = (confidence: number): string => {
    if (confidence >= 75) return `strong confidence of ${confidence.toFixed(1)}%`;
    if (confidence >= 50) return `reliable confidence level of ${confidence.toFixed(1)}%`;
    return `neutral sentiments at ${confidence.toFixed(1)}%`;
  };

  // Define valuation comparison description
  const getValuationDescription = (roi: number): string => {
    if (roi > 50) return `amusingly above`;
    if (roi >= 25) return `satisfactorily above`;
    if (roi >= 10) return `notably above`;
    if (roi > 0) return `slightly above`;
    if (roi === 0) return `at`;
    if (roi >= -5) return `slightly below`;
    if (roi >= -30) return `notably below`;
    return `horrifyingly below`;
  };
  
  // Set of opening statements that avoid redundancy and "with" constructions
  const openings = [
    `${month} ${year} shows ${coinName} establishing a trading range from $${formatPrice(minPrice)} to $${formatPrice(maxPrice)}.`,
    `${coinName} price action in ${month} ${year} points to a trading corridor of $${formatPrice(minPrice)}-$${formatPrice(maxPrice)}.`,
    `${month} ${year} projects ${coinName} trading between $${formatPrice(minPrice)} and $${formatPrice(maxPrice)}.`,
    `${coinName} could reach $${formatPrice(minPrice)}-$${formatPrice(maxPrice)} during ${month} ${year}.`,
    `A bullish ${month} ${year} outlook places ${coinName} at the range of $${formatPrice(minPrice)}-$${formatPrice(maxPrice)}.`
  ];
  
  // Varied price analysis statements with updated descriptions
  const priceAnalysis = [
    `Our research and analysis model calculates an average price of $${formatPrice(avgPrice)}, representing ${getGainDescription(roi)} from current levels.`,
    `Technical analysis suggests an average value of $${formatPrice(avgPrice)}, ${getGainDescription(roi)} from today's price.`,
    `The forecast indicates an average price target of $${formatPrice(avgPrice)}, ${roi.toFixed(2)}% ${getValuationDescription(roi)} the current valuation.`,
    `Analysis projects an average of $${formatPrice(avgPrice)}, yielding a ${getRoiDescription(roi)} on investment.`
  ];
  
  // Contextual supporting statements
  const supportingContext = [
    `This bullish scenario aligns with ${monthlyContext.seasonal === 'bullish' ? 'modern market dynamics' : monthlyContext.seasonal === 'volatile' ? 'analytical trend indicators' : 'traditional trend continuation patterns'} observed during this period.`,
    `${quarterInfo.quarter}'s typical market dynamics support this outlook.`,
    `${monthlyContext.market} contributes to this positive projection`,
    `${yearContext} creates a favorable backdrop for this prediction.`
  ];
  
  // Confidence statements with updated descriptions
  const confidenceStatement = [
    `Technical indicators also support this prediction with ${getConfidenceDescription(confidence)}.`,
    `Our research and analysis model shows ${getConfidenceDescription(confidence)}.`,
    `The projection carries ${getConfidenceDescription(confidence)} based on multiple indicators.`,
    `Analysis indicates ${getConfidenceDescription(confidence)} in this bullish scenario.`
  ];
  
  // Select one statement from each category randomly for variety
  const opening = openings[Math.floor(Math.random() * openings.length)];
  const analysis = priceAnalysis[Math.floor(Math.random() * priceAnalysis.length)];
  const context = supportingContext[Math.floor(Math.random() * supportingContext.length)];
  const confidencePhrase = confidenceStatement[Math.floor(Math.random() * confidenceStatement.length)];
  
  // Combine into a coherent paragraph
  return `${opening} ${analysis} ${context} ${confidencePhrase}`;
};

/**
 * Improved bearish scenario generator with cleaner text generation
 */
const generateBearishScenario = (
  coinName: string,
  monthIndex: number,
  year: number,
  minPrice: number,
  maxPrice: number,
  avgPrice: number,
  roi: number,
  confidence: number,
  currentPrice: number
): string => {
  const monthlyContext = getMonthContext(monthIndex);
  const quarterInfo = getQuarterInfo(monthIndex);
  const yearContext = getYearContext(year);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = months[monthIndex];
  
  // Format prices for display
  const formatPrice = (price: number): string => {
    if (price < 0.0001) return price.toFixed(8);
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    if (price < 100) return price.toFixed(2);
    return price.toLocaleString(undefined, {maximumFractionDigits: 0});
  };

  // Define ROI description based on percentage ranges
  const getRoiDescription = (roi: number): string => {
    if (roi > 35) return `substantial return (${roi.toFixed(2)}%)`;
    if (roi >= 15) return `significant return (${roi.toFixed(2)}%)`;
    if (roi > 0) return `positive potential return (${roi.toFixed(2)}%)`;
    if (roi === 0) return `neutral return`;
    if (roi >= -5) return `slightly negative return (${roi.toFixed(2)}%)`;
    if (roi >= -10) return `moderately negative return (${roi.toFixed(2)}%)`;
    return `significantly negative return (${roi.toFixed(2)}%)`;
  };

  // Define gain/decline description based on percentage ranges
  const getGainDescription = (roi: number): string => {
    if (roi > 25) return `an impressive gain (${roi.toFixed(2)}%)`;
    if (roi >= 10) return `a significant surge (${roi.toFixed(2)}%)`;
    if (roi > 0) return `a slight gain (${roi.toFixed(2)}%)`;
    if (roi >= -5) return `a slight decline (${roi.toFixed(2)}%)`;
    if (roi >= -20) return `a notable decline (${roi.toFixed(2)}%)`;
    return `a terrifying decline (${roi.toFixed(2)}%)`;
  };

  // Define confidence level description
  const getConfidenceDescription = (confidence: number): string => {
    if (confidence >= 75) return `strong confidence of ${confidence.toFixed(1)}%`;
    if (confidence >= 50) return `reliable confidence level of ${confidence.toFixed(1)}%`;
    return `neutral sentiments at ${confidence.toFixed(1)}%`;
  };

  // Define valuation comparison description
  const getValuationDescription = (roi: number): string => {
    if (roi > 50) return `amusingly above`;
    if (roi >= 25) return `satisfactorily above`;
    if (roi >= 10) return `notably above`;
    if (roi > 0) return `slightly above`;
    if (roi === 0) return `at`;
    if (roi >= -5) return `slightly below`;
    if (roi >= -30) return `notably below`;
    return `horrifyingly below`;
  };
  
  // Determine if this is bearish or just conservative
  const sentimentTerm = roi < 0 ? "bearish" : "conservative";
  
  // Set of opening statements that avoid redundancy and "with" constructions
  const openings = [
    `${month} ${year} suggests ${coinName} trading between $${formatPrice(minPrice)} and $${formatPrice(maxPrice)}.`,
    `${coinName} may trade in a range of $${formatPrice(minPrice)}-$${formatPrice(maxPrice)} during ${month} ${year}.`,
    `${month} ${year} indicates a ${coinName} price corridor of $${formatPrice(minPrice)}-$${formatPrice(maxPrice)}.`,
    `A ${sentimentTerm} ${month} ${year} places ${coinName} at $${formatPrice(minPrice)}-$${formatPrice(maxPrice)}.`,
    `${coinName} price action for ${month} ${year} shows a range of $${formatPrice(minPrice)}-$${formatPrice(maxPrice)}.`
  ];
  
  // Varied price analysis statements with updated descriptions
  const priceAnalysis = [
    `Our well-established and trained analysis model calculates an average price of $${formatPrice(avgPrice)}, representing ${getGainDescription(roi)} from current levels.`,
    `Technical analysis suggests an average value of $${formatPrice(avgPrice)}, ${getGainDescription(roi)} from today's price.`,
    `The forecast indicates an average price target of $${formatPrice(avgPrice)}, ${roi.toFixed(2)}% ${getValuationDescription(roi)} the current valuation.`,
    `Analysis projects an average of $${formatPrice(avgPrice)}, yielding a ${getRoiDescription(roi)} on investment.`
  ];
  
  // Contextual supporting statements
  const supportingContext = [
    `This ${sentimentTerm} scenario accounts for ${monthlyContext.seasonal}.`,
    `${quarterInfo.quarter}'s market dynamics factor into this projection.`,
    `${monthlyContext.market} influences this ${sentimentTerm} outlook.`,
    `${yearContext} provides important context for this forecast.`
  ];
  
  // Confidence statements with updated descriptions
  const confidenceStatement = [
    `Our indicators-based and reliable analysis model shows ${getConfidenceDescription(confidence)}.`,
    `Technical indicators also support this prediction with ${getConfidenceDescription(confidence)}.`,
    `The projection carries ${getConfidenceDescription(confidence)} based on multiple factors.`,
    `Analysis indicates ${getConfidenceDescription(confidence)} in this scenario.`
  ];
  
  // Select one statement from each category randomly for variety
  const opening = openings[Math.floor(Math.random() * openings.length)];
  const analysis = priceAnalysis[Math.floor(Math.random() * priceAnalysis.length)];
  const context = supportingContext[Math.floor(Math.random() * supportingContext.length)];
  const confidencePhrase = confidenceStatement[Math.floor(Math.random() * confidenceStatement.length)];
  
  // Combine into a coherent paragraph
  return `${opening} ${analysis} ${context} ${confidencePhrase}`;
};

const generateYearlyPredictions = (
  currentPrice: number,
  historicalVolatility: number,
  marketCap: number,
  currentYear: number
): YearlyPredictions => {
  const yearlyPredictions: YearlyPredictions = {};
  const yearOptions = Array.from(
    { length: 31 }, 
    (_, i) => currentYear + i
  );
  
  // Base growth rates for different market phases
  const baseGrowthRates: { [key: string]: number } = {
    bullish: 1.15,     // 15% monthly growth in bull markets
    neutral: 1.03,     // 3% monthly growth in neutral markets
    bearish: 0.92,     // 8% monthly decline in bear markets
    recovery: 1.08     // 8% monthly growth in recovery phases
  };
  
  // Market cap adjustment factors
  const marketCapMultipliers: { [key: number]: number } = {
    1e6: 1.3,    // Micro-cap (<$1M): 1.3x multiplier
    1e7: 1.2,    // Very small cap ($1M-$10M): 1.2x multiplier
    1e8: 1.15,   // Small cap ($10M-$100M): 1.15x multiplier
    1e9: 1.1,    // Medium cap ($100M-$1B): 1.1x multiplier
    10e9: 1.0,   // Large cap ($1B-$10B): no multiplier
    100e9: 0.9,  // Mega cap ($10B-$100B): 0.9x multiplier
    1000e9: 0.8  // Ultra cap (>$100B): 0.8x multiplier
  };
  
  // Find the appropriate market cap multiplier
  let marketCapMultiplier = 1.0;
  const marketCapThresholds = Object.keys(marketCapMultipliers).map(Number).sort((a, b) => a - b);
  
  for (let i = 0; i < marketCapThresholds.length; i++) {
    if (marketCap <= marketCapThresholds[i] || i === marketCapThresholds.length - 1) {
      marketCapMultiplier = marketCapMultipliers[marketCapThresholds[i]];
      break;
    }
  }
  
  // Generate market cycles - each cycle is ~4 years (48 months)
  // This creates a more realistic pattern with bull and bear markets
  const generateMarketCycles = (totalMonths: number): string[] => {
    const marketPhases: string[] = [];
    
    // Start with a slightly bullish phase for the first few months
    for (let i = 0; i < 3; i++) {
      marketPhases.push('neutral');
    }
    
    let remainingMonths = totalMonths - 3;
    let cycleStart = 3;
    
    while (remainingMonths > 0) {
      // Each full cycle is approximately 48 months (4 years)
      // Bull market: ~12 months
      // Bear market: ~10 months
      // Recovery: ~8 months
      // Neutral: ~18 months
      
      // Add bull market phase (12 months)
      const bullDuration = Math.min(remainingMonths, 10 + Math.floor(Math.random() * 5));
      for (let i = 0; i < bullDuration; i++) {
        marketPhases[cycleStart + i] = 'bullish';
      }
      cycleStart += bullDuration;
      remainingMonths -= bullDuration;
      if (remainingMonths <= 0) break;
      
      // Add bear market phase (10 months)
      const bearDuration = Math.min(remainingMonths, 8 + Math.floor(Math.random() * 5));
      for (let i = 0; i < bearDuration; i++) {
        marketPhases[cycleStart + i] = 'bearish';
      }
      cycleStart += bearDuration;
      remainingMonths -= bearDuration;
      if (remainingMonths <= 0) break;
      
      // Add recovery phase (8 months)
      const recoveryDuration = Math.min(remainingMonths, 6 + Math.floor(Math.random() * 5));
      for (let i = 0; i < recoveryDuration; i++) {
        marketPhases[cycleStart + i] = 'recovery';
      }
      cycleStart += recoveryDuration;
      remainingMonths -= recoveryDuration;
      if (remainingMonths <= 0) break;
      
      // Add neutral phase (18 months)
      const neutralDuration = Math.min(remainingMonths, 15 + Math.floor(Math.random() * 7));
      for (let i = 0; i < neutralDuration; i++) {
        marketPhases[cycleStart + i] = 'neutral';
      }
      cycleStart += neutralDuration;
      remainingMonths -= neutralDuration;
    }
    
    return marketPhases;
  };
  
  // Calculate total months needed for all predictions
  const lastYear = Math.max(...yearOptions);
  const totalMonths = (lastYear - currentYear + 1) * 12;
  
  // Generate market phases for all months
  const marketPhases = generateMarketCycles(totalMonths);
  
  // Track cumulative price for continuity between years
  let cumulativePrice = currentPrice;
  let globalMonthIndex = 0;
  
  // Generate predictions for each year
  for (const year of yearOptions) {
    const yearsFromNow = year - currentYear;
    
    // Generate monthly predictions for this year
    const monthlyPredictions: MonthlyPrediction[] = [];
    const currentMonth = new Date().getMonth();
    
    for (let month = 0; month < 12; month++) {
      // Skip past months in current year
      if (year === currentYear && month < currentMonth) continue;
      
      const monthDate = new Date(year, month, 15);
      const monthName = format(monthDate, 'MMMM');
      const shortMonthName = format(monthDate, 'MMM');
      const monthsFromNow = (year - currentYear) * 12 + month - currentMonth;
      
      // Get market phase for this month
      const marketPhase = marketPhases[globalMonthIndex] || 'neutral';
      globalMonthIndex++;
      
      // Get base growth rate for this market phase
      let monthlyGrowthRate = baseGrowthRates[marketPhase];
      
      // Apply market cap multiplier
      if (marketPhase === 'bullish' || marketPhase === 'recovery') {
        // In bull markets, smaller caps can grow faster
        monthlyGrowthRate = 1 + ((monthlyGrowthRate - 1) * marketCapMultiplier);
      } else if (marketPhase === 'bearish') {
        // In bear markets, larger caps tend to be more stable
        const bearishMultiplier = 1 + (1 - marketCapMultiplier) * 0.5;
        monthlyGrowthRate = 1 - ((1 - monthlyGrowthRate) * bearishMultiplier);
      }
      
      // Apply long-term growth adjustment (diminishing returns for distant years)
      if (yearsFromNow > 10) {
        // For very long-term predictions, growth rates tend to normalize
        const longTermFactor = Math.max(0.8, 1 - (yearsFromNow - 10) / 50);
        if (monthlyGrowthRate > 1) {
          // Reduce growth in bull markets for distant years
          monthlyGrowthRate = 1 + ((monthlyGrowthRate - 1) * longTermFactor);
        } else if (monthlyGrowthRate < 1) {
          // Reduce decline in bear markets for distant years
          monthlyGrowthRate = 1 - ((1 - monthlyGrowthRate) * longTermFactor);
        }
      }
      
      // Add some randomness based on volatility and market phase
      let volatilityMultiplier = 1;
      if (marketPhase === 'bullish') volatilityMultiplier = 1.2;
      if (marketPhase === 'bearish') volatilityMultiplier = 1.5;
      
      const randomFactor = 1 + (Math.random() * 2 - 1) * (historicalVolatility / 300) * volatilityMultiplier;
      
      // Calculate predicted price with continuity from previous month
      const predictedPrice = cumulativePrice * monthlyGrowthRate * randomFactor;
      cumulativePrice = predictedPrice; // Update for next month
      
      // Apply a cap to ensure ROI doesn't exceed 3000% for the furthest predictions
      const maxAllowedPrice = currentPrice * (30 + (yearsFromNow * 0.7));
      if (predictedPrice > maxAllowedPrice) {
        cumulativePrice = maxAllowedPrice;
      }
      
      // Calculate min and max prices based on market phase and volatility
      let volatilityFactor = Math.min(30, historicalVolatility * (1 + monthsFromNow / 100));
      if (marketPhase === 'bullish') volatilityFactor *= 1.2;
      if (marketPhase === 'bearish') volatilityFactor *= 1.5;
      
      const minPrice = cumulativePrice * (1 - volatilityFactor / 100);
      const maxPrice = cumulativePrice * (1 + volatilityFactor / 100);
      
      // Calculate ROI
      const roi = ((cumulativePrice / currentPrice) - 1) * 100;
      
      // Determine sentiment based on market phase and ROI
      // Determine sentiment based on ROI and market phase
      let sentiment = "Neutral";
      if (roi < -50) {
        sentiment = "Extremely Bearish";
      } else if (roi < -30) {
        sentiment = "Moderately Bearish";
      } else if (roi < 0) {
        sentiment = "Slightly Bearish";
      } else if (roi < 20) {
        sentiment = "Neutral";
      } else if (roi < 100) {
        sentiment = "Slightly Bullish";
      } else if (roi < 500) {
        sentiment = "Mildly Bullish";
      } else {
        sentiment = "Extremely Bullish";
      }
      
      // Adjust sentiment based on market phase
      if (marketPhase === 'bullish' && sentiment !== "Extremely Bullish") {
        // Bump up sentiment in bullish markets
        if (sentiment === "Mildly Bullish") sentiment = "Extremely Bullish";
        else if (sentiment === "Slightly Bullish") sentiment = "Mildly Bullish";
        else if (sentiment === "Neutral") sentiment = "Slightly Bullish";
      } else if (marketPhase === 'bearish' && sentiment !== "Extremely Bearish") {
        // Lower sentiment in bearish markets
        if (sentiment === "Moderately Bearish") sentiment = "Extremely Bearish";
        else if (sentiment === "Slightly Bearish") sentiment = "Moderately Bearish";
        else if (sentiment === "Neutral") sentiment = "Slightly Bearish";
      }
      
      // Generate bullish and bearish scenarios
      const confidence = Math.max(60, 90 - (monthsFromNow / 4));
      
      // Generate monthly description and scenario texts
      const bullishScenario = generateBullishScenario(
        "Bitcoin", 
        month, 
        year, 
        minPrice, 
        maxPrice, 
        cumulativePrice, 
        roi, 
        confidence, 
        currentPrice
      );
      
      const bearishScenario = generateBearishScenario(
        "Bitcoin", 
        month, 
        year, 
        minPrice, 
        maxPrice, 
        cumulativePrice, 
        roi, 
        confidence, 
        currentPrice
      );
      
      const description = roi >= 0 ? bullishScenario : bearishScenario;
      
      // Add the monthly prediction with ID formatted as required
      monthlyPredictions.push({
        month: monthName,
        year,
        price: cumulativePrice,
        minPrice,
        maxPrice,
        roi,
        sentiment: sentiment.toLowerCase(),
        marketPhase,
        confidence,
        description,
        bullishScenario,
        bearishScenario
      });
    }
    
    // Only add years that have predictions (skip years with no months)
    if (monthlyPredictions.length > 0) {
    yearlyPredictions[year] = monthlyPredictions;
    }
  }
  
  return yearlyPredictions;
};

// Add the fetchChartData function
const fetchChartData = async (id: string): Promise<any[]> => {
  try {
    // Use the existing chart API endpoint to get historical data
    const response = await fetch(getApiUrl(`/coin/chart/${id}`));
    
    if (!response.ok) {
      throw new Error(`Failed to fetch chart data: ${response.status}`);
    }
    
    const chartData = await response.json();
    
    // Ensure we have the required data structure
    if (!Array.isArray(chartData) || chartData.length === 0) {
      throw new Error('Invalid chart data format');
    }
    
    return chartData;
  } catch (error) {
    console.error('Error fetching chart data:', error);
    
    // Return a minimal dataset if we can't get the real data
    // This prevents the entire prediction from failing
    return [
      { timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000, price: 1000, volume: 1000000 },
      { timestamp: Date.now(), price: 1100, volume: 1100000 }
    ];
  }
};

const generatePredictionChartData = (
  chartData: any[], 
  currentPrice: number, 
  targetDate: Date,
  yearlyPredictions: YearlyPredictions
) => {
  if (!chartData.length) return [{ time: Date.now(), price: currentPrice }];

  // Start with current price
  const result = [{ time: Date.now(), price: currentPrice }];
  
  // Current date for reference
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  
  // Generate data points for future dates (up to 1 year)
  const intervals = 30; // Number of data points to generate
  const maxDays = 365; // Maximum days to predict
  
  // Helper to get a price estimate for a date based on yearlyPredictions
  const getPriceEstimate = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    
    // If this is a date within the next 10 days, use linear interpolation
    const daysDiff = Math.floor((date.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 10) {
      // Find the first monthly prediction
      const firstYearData = yearlyPredictions[currentYear];
      if (!firstYearData) return currentPrice;
      
      // Find the earliest month available
      const sortedMonths = firstYearData.sort((a, b) => getMonthIndex(a.month) - getMonthIndex(b.month));
      const earliestPrediction = sortedMonths[0];
      
      if (!earliestPrediction) return currentPrice;
      
      // Linear interpolation between current price and first monthly prediction
      const daysToFirstMonth = (getMonthIndex(earliestPrediction.month) - currentMonth) * 30;
      if (daysToFirstMonth <= 0) return earliestPrediction.price;
      
      // Simple linear interpolation
      const progress = daysDiff / Math.max(daysToFirstMonth, 30); // Avoid division by zero
      return currentPrice + progress * (earliestPrediction.price - currentPrice);
    }
    
    // For dates beyond 10 days, find the closest monthly prediction
    if (!yearlyPredictions[year]) {
      // If we don't have data for this year, use the last available year
      const years = Object.keys(yearlyPredictions).map(Number).sort();
      const lastYear = years[years.length - 1];
      if (!lastYear) return currentPrice;
      
      // For future years beyond our predictions, use the December of last year
      const decemberPrediction = yearlyPredictions[lastYear].find(p => p.month === "December");
      return decemberPrediction ? decemberPrediction.price : currentPrice;
    }
    
    // Find the prediction for this month or the closest one
    const monthlyData = yearlyPredictions[year];
    let closestPrediction = null;
    let minDistance = Infinity;
    
    for (const prediction of monthlyData) {
      const predictionMonth = getMonthIndex(prediction.month);
      const distance = Math.abs(predictionMonth - month);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestPrediction = prediction;
      }
    }
    
    return closestPrediction ? closestPrediction.price : currentPrice;
  };

  for (let i = 1; i <= intervals; i++) {
    const daysInFuture = Math.floor((i / intervals) * maxDays);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysInFuture);

    // Get price from yearly predictions for consistency
    const predictedPrice = getPriceEstimate(futureDate);

    result.push({
      time: futureDate.getTime(),
      price: predictedPrice
    });
  }

  return result;
};

// Add a helper function to calculate average of an array
const calculateAverage = (prices: number[]): number => {
  if (prices.length === 0) return 0;
  return prices.reduce((sum, price) => sum + price, 0) / prices.length;
};

// Calculate Fear & Greed Index
function calculateFearGreedIndex(prices: number[], volumes: number[]): number {
  // Simple implementation - can be expanded with more factors
  const volatility = calculateVolatility(prices.slice(-30));
  const recentVolumes = volumes.slice(-7);
  const avgVolume = calculateAverage(recentVolumes);
  const volumeChange = (volumes[volumes.length - 1] / avgVolume) - 1;

  const recentPrices = prices.slice(-7);
  const avgPrice = calculateAverage(recentPrices);
  const priceChange = (prices[prices.length - 1] / avgPrice) - 1;

  // Convert these factors to a 0-100 scale
  const volatilityScore = Math.min(100, Math.max(0, 50 - (volatility * 100)));
  const volumeScore = Math.min(100, Math.max(0, 50 + (volumeChange * 100)));
  const priceScore = Math.min(100, Math.max(0, 50 + (priceChange * 100)));

  // Average the scores
  return Math.round((volatilityScore + volumeScore + priceScore) / 3);
}

const getMonthIndex = (monthName: string): number => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  return months.findIndex(m => m === monthName);
};

const findClosestMonthlyPrediction = (
  yearlyPredictions: YearlyPredictions,
  targetYear: number, 
  targetMonth: number,
  currentPrice: number
): PredictionResult => {
  // Default response in case we can't find a matching prediction
  const defaultResult: PredictionResult = {
    price: currentPrice * 1.1, // 10% higher as fallback
    minPrice: currentPrice * 0.9,
    maxPrice: currentPrice * 1.3,
    roi: 10,
    confidence: 70,
    sentiment: "Neutral"
  };
  
  // Check if we have predictions for the target year
  if (!yearlyPredictions[targetYear]) {
    return defaultResult;
  }
  
  // Find the monthly prediction closest to the target month
  let closestPrediction: MonthlyPrediction | null = null;
  let minDistance = Infinity;
  
  for (const prediction of yearlyPredictions[targetYear]) {
    const predictionMonth = getMonthIndex(prediction.month);
    const distance = Math.abs(predictionMonth - targetMonth);
    
    if (distance < minDistance) {
      minDistance = distance;
      closestPrediction = prediction;
    }
  }
  
  // If we found a prediction, convert it to PredictionResult format
  if (closestPrediction) {
    return {
      price: closestPrediction.price,
      minPrice: closestPrediction.minPrice,
      maxPrice: closestPrediction.maxPrice,
      roi: closestPrediction.roi,
      confidence: closestPrediction.confidence,
      sentiment: closestPrediction.sentiment
    };
  }
  
  return defaultResult;
};

const generatePredictions = async (id: string) => {
  try {
    // Fetch historical price data
    const chartData = await fetchChartData(id);
    
    // Extract prices and volumes for calculations
    const prices = chartData.map((point: any) => point.price);
    const volumes = chartData.map((point: any) => point.volume || 0);
    
    // Get current price from latest chart data point
    const currentPrice = prices[prices.length - 1] || 0;
    
    // Fetch market cap data if available
    let marketCap = 1e9; // Default to $1B if not available
    try {
      const priceResponse = await fetch(getApiUrl(`/coin/price/${id}`));
      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        marketCap = priceData.market_cap || marketCap;
      }
    } catch (error) {
      console.error('Error fetching market cap data:', error);
    }
    
    // Get coin info for name and ticker
    let coinName = "Bitcoin";
    let ticker = "BTC";
    let rank = 1;
    try {
      const coinInfoResponse = await fetch(getApiUrl(`/coin/id/${id}`));
      if (coinInfoResponse.ok) {
        const coinInfo = await coinInfoResponse.json();
        coinName = coinInfo.name || "Bitcoin";
        ticker = coinInfo.ticker || "BTC";
        rank = coinInfo.rank || 1;
      }
    } catch (error) {
      console.error('Error fetching coin info:', error);
    }
    
    // Calculate volatility for use in predictions
    const historicalVolatility = calculateVolatility(prices.slice(-30));
    
    // Generate yearly predictions first, so we can use that data for consistency
    const currentYear = new Date().getFullYear();
    const yearlyPredictions = generateYearlyPredictions(
      currentPrice,
      historicalVolatility,
      marketCap,
      currentYear
    );
    
    // Generate specific timeframe predictions
    const threeDayDate = new Date();
    threeDayDate.setDate(threeDayDate.getDate() + 3);
    
    const fiveDayDate = new Date();
    fiveDayDate.setDate(fiveDayDate.getDate() + 5);
    
    const oneMonthDate = new Date();
    oneMonthDate.setMonth(oneMonthDate.getMonth() + 1);
    
    const threeMonthDate = new Date();
    threeMonthDate.setMonth(threeMonthDate.getMonth() + 3);
    
    const sixMonthDate = new Date();
    sixMonthDate.setMonth(sixMonthDate.getMonth() + 6);
    
    const oneYearDate = new Date();
    oneYearDate.setFullYear(oneYearDate.getFullYear() + 1);
    
    // For shorter-term predictions (< 2 weeks), use the standard prediction function
    const threeDayPrediction = calculatePricePrediction(prices, volumes, currentPrice, threeDayDate);
    const fiveDayPrediction = calculatePricePrediction(prices, volumes, currentPrice, fiveDayDate);
    
    // For longer predictions, extract from yearlyPredictions to ensure consistency
    // We'll need to find the closest monthly prediction to our target dates
    
    // Find the closest monthly prediction to oneMonthDate
    const oneMonthYear = oneMonthDate.getFullYear();
    const oneMonthMonth = oneMonthDate.getMonth();
    const oneMonthPrediction = findClosestMonthlyPrediction(yearlyPredictions, oneMonthYear, oneMonthMonth, currentPrice);
    
    // Find the closest monthly prediction to threeMonthDate
    const threeMonthYear = threeMonthDate.getFullYear();
    const threeMonthMonth = threeMonthDate.getMonth();
    const threeMonthPrediction = findClosestMonthlyPrediction(yearlyPredictions, threeMonthYear, threeMonthMonth, currentPrice);
    
    // Find the closest monthly prediction to sixMonthDate
    const sixMonthYear = sixMonthDate.getFullYear();
    const sixMonthMonth = sixMonthDate.getMonth();
    const sixMonthPrediction = findClosestMonthlyPrediction(yearlyPredictions, sixMonthYear, sixMonthMonth, currentPrice);
    
    // Find the closest monthly prediction to oneYearDate
    const oneYearYear = oneYearDate.getFullYear();
    const oneYearMonth = oneYearDate.getMonth();
    const oneYearPrediction = findClosestMonthlyPrediction(yearlyPredictions, oneYearYear, oneYearMonth, currentPrice);
    
    // Generate prediction chart data
    const predictionChartData = generatePredictionChartData(
      chartData,
      currentPrice,
      oneYearDate,
      yearlyPredictions
    );
    
    // Calculate additional technical indicators
    const sma50Values = calculateSMA(prices, 50);
    const sma50 = sma50Values[sma50Values.length - 1] || 0;
    
    const sma200Values = calculateSMA(prices, 200);
    const sma200 = sma200Values[sma200Values.length - 1] || 0;
    
    const rsiValues = calculateRSI(prices);
    const rsi14 = rsiValues[rsiValues.length - 1] || 50;
    
    // Calculate Fear & Greed Index
    const fearGreedIndex = calculateFearGreedIndex(prices, volumes);
    let fearGreedZone = "Neutral";
    if (fearGreedIndex <= 24) fearGreedZone = "Extreme Fear";
    else if (fearGreedIndex <= 49) fearGreedZone = "Fear";
    else if (fearGreedIndex <= 74) fearGreedZone = "Greed";
    else fearGreedZone = "Extreme Greed";
    
    // Calculate green days in last 30 days
    const greenDays = prices.slice(-30).reduce((count, price, index, arr) => {
      if (index === 0) return 0;
      return price > arr[index - 1] ? count + 1 : count;
    }, 0);
    const greenDaysFormatted = `${greenDays}/30 (${Math.round(greenDays / 30 * 100)}%)`;
    
    // Determine if it's profitable to invest based on indicators
    const isProfitable = rsi14 > 50 && sma50 > sma200 && greenDays > 15;
    
    // Return the complete prediction data in the desired format
    return {
      currentPrice,
      rank,
      predictions: {
        threeDay: threeDayPrediction,
        fiveDay: fiveDayPrediction,
        oneMonth: oneMonthPrediction,
        threeMonth: threeMonthPrediction,
        sixMonth: sixMonthPrediction,
        oneYear: oneYearPrediction
      },
      chartData: predictionChartData,
      yearlyPredictions,
      technicalIndicators: {
        sma50,
        sma200,
        rsi14,
        fearGreedIndex,
        fearGreedZone,
        greenDays: greenDaysFormatted,
        isProfitable
      }
    };
  } catch (error) {
    console.error('Error generating predictions:', error);
    throw error;
  }
};


// Add this handler function to wrap everything together
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { id } = req.query;
    const forceRefresh = req.query.refresh === 'true';

    if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: 'Invalid id parameter' });
    }

    try {
        // Check if we have cached predictions
        const cacheKey = `coin_prediction_${id}`;
        
        // // If not forcing a refresh, try to get from cache
        if (!forceRefresh) {
          const cachedPredictions = await redisHandler.get(cacheKey);
          if (cachedPredictions) {
            return res.status(200).json(cachedPredictions);
          }
        }
    
    // Generate new predictions with the fixed function
        const predictions = await generatePredictions(id);
        
        // Cache the predictions for 24 hours
        await redisHandler.set(cacheKey, predictions, { expirationTime: 24 * 60 * 60 });
        
        // Return the predictions
        return res.status(200).json(predictions);
    } catch (error) {
        console.error('Error in prediction API handler:', error);
        return res.status(500).json({ message: 'Error generating predictions' });
    }
} 