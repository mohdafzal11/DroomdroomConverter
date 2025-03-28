import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import { GetServerSideProps } from 'next';
import { getApiUrl } from 'utils/config';
import SEO from 'components/SEO/SEO';
import Navbar from 'components/Navbar/Navbar';
import Market from 'src/components/Market/Market';
import About from 'src/components/About';
import FAQ from 'src/components/FAQ';
import Related from 'src/components/Related';
import ConversionTables from 'src/components/ConversionTables';
import SimilarCrypto from 'src/components/SimilarCrypto/SimilarCrypto';
import SearchCoin from 'src/components/SearchCoin/SearchCoin';
import MoreConversions from 'src/components/MoreConversions/MoreConversions';
import { useCurrency, CURRENCIES } from 'src/context/CurrencyContext';

interface TokenData {
  id: string;
  ticker: string;
  name: string;
  price: number;
  iconUrl?: string;
  cmcId: number;
  status: string;
  rateChange: {
    hourly: number;
    daily: number;
  };
  marketCap: string;
  volume: string;
  supply: string;
  supplyUnit: string;

}

interface ConverterProps {
  tokens: TokenData[];
}

const ConverterContainer = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 16px;
  width: 100%;
`;

const ConverterCard = styled.div`
  background: ${({ theme }) => theme.colors.bgColor};
  padding: 32px 0;
  margin: 24px auto;
  max-width: 900px;
  
  @media (max-width: 768px) {
    padding: 24px 0;
    margin: 16px auto;
  }
`;

const IconsWrapper = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 16px;
`;

const CryptoIcon = styled.img`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  margin-right: -8px;
`;

const ConversionHeader = styled.div`
  margin-bottom: 24px;
`;

const Title = styled.h1`
  font-size: 28px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textColor};
  margin: 8px 0;
  
  @media (max-width: 480px) {
    font-size: 24px;
  }
`;

const ExchangeRate = styled.p`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textColorSub};
  margin: 0;
`;

const ConversionForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const InputRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const InputWrapper = styled.div`
  flex: 1;
  position: relative;

  &:first-child {
    margin-right: 12px;
  }

  @media (max-width: 768px) {
    width: 100%;
    &:first-child {
      margin-right: 0;
      margin-bottom: 12px;
    }
  }
`;

const SwapIconWrapper = styled.div`
  display: flex;
  justify-content: center;
  margin: 0 8px;
  
  @media (max-width: 768px) {
    display: none;
  }
`;

const SwapButton = styled.button`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.colorNeutral2};
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textColorSub};

  svg {
    width: 20px;
    height: 20px;
    stroke: currentColor;
  }
`;

const Input = styled.input`
  width: 100%;
  height: 56px;
  border: 1px solid ${({ theme }) => theme.colors.colorNeutral2};
  border-radius: 100px;
  background: ${({ theme }) => theme.colors.controlBackgroundColor};
  color: ${({ theme }) => theme.colors.textColor};
  font-size: 16px;
  padding: 0 120px 0 24px;
  
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.borderColor};
  }
`;

const SelectWrapper = styled.div`
  position: absolute;
  right: 4px;
  top: 4px;
  bottom: 4px;
  display: flex;
  align-items: center;
`;

const SelectButton = styled.button`
  height: 48px;
  min-width: 100px;
  padding: 0 36px 0 16px;
  border: none;
  border-radius: 100px;
  background: ${({ theme }) => theme.name === 'dark' ? theme.colors.colorNeutral3 : theme.colors.colorNeutral2};
  color: ${({ theme }) => theme.colors.textColor};
  font-size: 16px;
  font-weight: 600;
  appearance: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  
  &:focus {
    outline: none;
  }
`;

const TokenIcon = styled.img`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  margin-right: 8px;
`;

const SelectArrow = styled.div`
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
`;

const BuyButtonWrapper = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 32px;
`;

const BuyButton = styled.button`
  background: #4A49F5;
  color: white;
  border: none;
  border-radius: 100px;
  padding: 12px 32px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  
  &:hover {
    background: #3938D0;
  }
`;

const LastUpdated = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 16px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textColorSub};
`;

const RefreshButton = styled.button`
  background: none;
  border: none;
  color: #4A49F5;
  font-weight: 600;
  cursor: pointer;
  margin-left: 8px;
  padding: 0;
  display: flex;
  align-items: center;
`;

const TokenName = styled.span<{ ticker?: string }>`
  color: ${({ ticker, theme }) => {
    const tokenColors: Record<string, string> = {
      'BTC': '#F7931A',
      'ETH': '#627EEA',
      'USDT': '#26A17B',
      'USDC': '#2775CA',
      'BNB': '#F3BA2F',
      'XRP': '#23292F',
      'ADA': '#0033AD',
      'SOL': '#14F195',
      'DOGE': '#C3A634',
      'DOT': '#E6007A'
    };
    
    return ticker && tokenColors[ticker] ? tokenColors[ticker] : theme.colors.themeColor;
  }};
  font-weight: 600;
`;

export const getServerSideProps: GetServerSideProps = async () => {
  try {
    const response = await axios.get(getApiUrl(`/coins`), {
      params: {
        page: 1,
        pageSize: 50,
      },
    });
    const tokens = response.data.tokens.map((token: any) => ({
      id: token.id || '',
      ticker: token.ticker || '',
      name: token.name || '',
      price: token.price || 0,
      iconUrl: token.cmcId ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${token.cmcId}.png` : '',
      cmcId: token.cmcId || 0,
      status: token.status || 'stable',
      rateChange: token.rateChange || { hourly: 0, daily: 0 },
      marketCap: token.marketCap || '0',
      volume: token.volume || '0',
      supply: token.supply || '0',
      supplyUnit: token.supplyUnit || '',
    }));

    return {
      props: {
        tokens,
      },
    };
  } catch (error) {
    console.error('Error fetching tokens:', error);
    return {
      props: {
        tokens: [],
      },
    };
  }
};

const getSymbol = (coin: any): string => {
  return typeof coin.ticker === 'string' ? coin.ticker : '';
};

const getToSymbol = (coin: any): string => {
  if (!coin.toToken) return '';
  return typeof coin.toToken === 'object' && coin.toToken.ticker 
    ? coin.toToken.ticker 
    : typeof coin.toToken === 'string' 
      ? coin.toToken 
      : '';
};

const Converter: React.FC<ConverterProps> = ({ tokens }) => {
  const [fromToken, setFromToken] = useState<TokenData | null>(
    tokens.find(t => t.ticker === 'BTC') || tokens[0]
  );
  const [toToken, setToToken] = useState<TokenData | null>(
    tokens.find(t => t.ticker === 'USDT') || tokens[1]
  );
  const [fromAmount, setFromAmount] = useState<string>('1');
  const [toAmount, setToAmount] = useState<string>('');
  const [showFromSearch, setShowFromSearch] = useState<boolean>(false);
  const [showToSearch, setShowToSearch] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>(
    new Date().toLocaleString('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  );

  const fromButtonRef = useRef<HTMLButtonElement>(null);
  const toButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (fromToken && toToken && fromAmount) {
      const amount = parseFloat(fromAmount);
      if (!isNaN(amount)) {
        const convertedAmount = (amount * fromToken.price) / toToken.price;
        setToAmount(convertedAmount.toFixed(toToken.ticker === 'USDT' ? 2 : 8));
      }
    }
  }, [fromToken, toToken, fromAmount]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        (fromButtonRef.current && !fromButtonRef.current.contains(event.target as Node)) ||
        (toButtonRef.current && !toButtonRef.current.contains(event.target as Node))
      ) {
        setShowFromSearch(false);
        setShowToSearch(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleDocumentClick = () => {
      if (showFromSearch || showToSearch) {
        setShowFromSearch(false);
        setShowToSearch(false);
      }
    };
    
    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [showFromSearch, showToSearch]);

  const handleSwapTokens = () => {
    const tempToken = fromToken;
    setFromToken(toToken);
    setToToken(tempToken);
    
    if (toAmount) {
      setFromAmount(toAmount);
    }
  };

  const toggleFromSearch = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (showToSearch) {
      setShowToSearch(false);
    }
    setTimeout(() => {
      setShowFromSearch(prev => !prev);
    }, 10);
  };

  const toggleToSearch = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (showFromSearch) {
      setShowFromSearch(false);
    }
    setTimeout(() => {
      setShowToSearch(prev => !prev);
    }, 10);
  };

  const handleRefresh = () => {
    setLastUpdated(
      new Date().toLocaleString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    );
  };

  const generateAdvancedOptions = () => {
    const from = tokens.find(t => t.ticker === fromToken?.ticker);
    const to = tokens.find(t => t.ticker === toToken?.ticker);
    
    const topCryptos = tokens
      .filter(t => !['USDT', 'USDC', 'DAI', 'BUSD'].includes(t.ticker))
      .sort((a, b) => parseFloat(b.marketCap) - parseFloat(a.marketCap))
      .slice(0, 10);
    
    const options = [];
    
    if (from) {
      topCryptos.forEach((crypto, index) => {
        options.push({
          id: `advanced-${index}`,
          name: `${crypto.name} to Tether`,
          fromToken: crypto.name,
          toToken: 'Tether',
          fromTicker: crypto.ticker,
          toTicker: 'USDT',
          iconUrl: crypto.iconUrl
        });
      });
    }
    
    if (to) {
      topCryptos.slice(0, 3).forEach((crypto, index) => {
        options.push({
          id: `advanced-usdc-${index}`,
          name: `${crypto.name} to USDC`,
          fromToken: crypto.name,
          toToken: 'USDC',
          fromTicker: crypto.ticker,
          toTicker: 'USDC',
          iconUrl: crypto.iconUrl
        });
      });
    }
    
    for (let i = 0; i < Math.min(4, topCryptos.length - 1); i++) {
      const fromCrypto = topCryptos[i];
      const toCrypto = topCryptos[i + 1];
      
      options.push({
        id: `advanced-cross-${i}`,
        name: `${fromCrypto.name} to ${toCrypto.name}`,
        fromToken: fromCrypto.name,
        toToken: toCrypto.name,
        fromTicker: fromCrypto.ticker,
        toTicker: toCrypto.ticker,
        iconUrl: fromCrypto.iconUrl
      });
    }
    
    return options.slice(0, 12); 
  };
  
  const generateCurrencyOptions = () => {
    const fiatCurrencies = Object.values(CURRENCIES); 
    
    const diverseCryptos = tokens
      .filter((t, index) => index % 10 === 0) 
      .slice(0, 8);
    
    return diverseCryptos.map((crypto, index) => ({
      id: `currency-${index}`,
      name: `${crypto.name} to ${fiatCurrencies[index].name}`,
      fromToken: crypto.name,
      toToken: fiatCurrencies[index].name,
      fromTicker: crypto.ticker,
      toTicker: fiatCurrencies[index].code,
      iconUrl: crypto.iconUrl
    }));
  };

  const advancedOptions = generateAdvancedOptions();
  const currencyOptions = generateCurrencyOptions();

  const closeAllSearchModals = () => {
    setShowFromSearch(false);
    setShowToSearch(false);
  };

  return (
    <ConverterContainer>
      <SEO
        title="Convert Cryptocurrencies | DroomDroom"
        description="Convert between cryptocurrencies like Bitcoin (BTC) and stablecoins like Tether (USDT) with real-time exchange rates."
        keywords="cryptocurrency converter, crypto swap, bitcoin converter, BTC to USDT, crypto exchange rates"
        ogType="website"
      />
      <ConverterCard>
        <IconsWrapper>
          <CryptoIcon src={fromToken?.cmcId ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${fromToken.cmcId}.png` : '/placeholder.png'} alt="BTC" />
          <CryptoIcon src={toToken?.cmcId ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${toToken.cmcId}.png` : '/placeholder.png'} alt="USDT" />
        </IconsWrapper>
        
        <ConversionHeader>
          <Title>
            Convert and swap {fromToken?.name} <TokenName ticker={fromToken?.ticker}>{fromToken?.ticker}</TokenName> to {toToken?.name} <TokenName ticker={toToken?.ticker}>{toToken?.ticker}</TokenName>
          </Title>
          <ExchangeRate>
            {fromToken?.ticker}/{toToken?.ticker}: 1 {fromToken?.ticker} equals {(fromToken?.price && toToken?.price) 
              ? (fromToken.price / toToken.price).toFixed(2)
              : '0'} {toToken?.ticker}
          </ExchangeRate>
        </ConversionHeader>
        
        <ConversionForm>
          <InputRow onClick={(e) => e.stopPropagation()}>
            <InputWrapper>
              <Input
                type="number"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
                placeholder="0"
                min="0"
                onClick={(e) => e.stopPropagation()}
              />
              <SelectWrapper>
                <SelectButton 
                  onClick={toggleFromSearch}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {fromToken?.iconUrl && <TokenIcon src={fromToken.iconUrl} alt={fromToken.ticker} />}
                  {fromToken?.ticker || 'Select'}
                  <SelectArrow>{showFromSearch ? '▲' : '▼'}</SelectArrow>
                </SelectButton>
              </SelectWrapper>
              
              {showFromSearch && (
                <div onClick={(e) => e.stopPropagation()}>
                  <SearchCoin 
                    coins={tokens} 
                    onSelectToken={(token) => {
                      setFromToken(token as TokenData);
                      setShowFromSearch(false);
                    }}
                    isVisible={showFromSearch}
                    onClose={() => setShowFromSearch(false)}
                  />
                </div>
              )}
            </InputWrapper>
            
            <SwapIconWrapper>
              <SwapButton onClick={(e) => {
                e.stopPropagation();
                handleSwapTokens();
              }}>
                <svg height="21" viewBox="0 0 21 21" width="21" xmlns="http://www.w3.org/2000/svg"><g fill="none" fill-rule="evenodd" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" transform="matrix(0 1 -1 0 18.5 2.5)"><g transform="matrix(0 -1 1 0 .5 16.5)"><path d="m16 0v5h-5" transform="matrix(0 1 1 0 11 -11)"/><path d="m16 5c-2.8366699-3.33333333-5.6700033-5-8.5-5-2.82999674 0-5.32999674 1-7.5 3"/></g><g transform="matrix(0 1 -1 0 14 1)"><path d="m16 0v5h-5" transform="matrix(0 1 1 0 11 -11)"/><path d="m16 5c-2.8366699-3.33333333-5.6700033-5-8.5-5-2.82999674 0-5.32999674 1-7.5 3"/></g></g></svg>
              </SwapButton>
            </SwapIconWrapper>
            
            <InputWrapper>
              <Input
                type="text"
                value={toAmount}
                readOnly
                placeholder="0"
                onClick={(e) => e.stopPropagation()}
              />
              <SelectWrapper>
                <SelectButton 
                  onClick={toggleToSearch}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {toToken?.iconUrl && <TokenIcon src={toToken.iconUrl} alt={toToken.ticker} />}
                  {toToken?.ticker || 'Select'}
                  <SelectArrow>{showToSearch ? '▲' : '▼'}</SelectArrow>
                </SelectButton>
              </SelectWrapper>
              
              {showToSearch && (
                <div onClick={(e) => e.stopPropagation()}>
                  <SearchCoin 
                    coins={tokens} 
                    onSelectToken={(token) => {
                      setToToken(token as TokenData);
                      setShowToSearch(false);
                    }}
                    isVisible={showToSearch}
                    onClose={() => setShowToSearch(false)}
                  />
                </div>
              )}
            </InputWrapper>
          </InputRow>
        </ConversionForm>
        
        <BuyButtonWrapper>
          <BuyButton>Buy {fromToken?.ticker}</BuyButton>
        </BuyButtonWrapper>
        
        <LastUpdated>
          Last update: {lastUpdated}
          <RefreshButton onClick={handleRefresh}>
            Refresh ↻
          </RefreshButton>
        </LastUpdated>
      </ConverterCard>
      <Navbar />
    
      <Market id="markets" fromToken={fromToken} toToken={toToken} />

      <About id="about" fromToken={fromToken} toToken={toToken} />

      <FAQ id="faq" fromToken={fromToken} toToken={toToken} />

      <Related id="related" fromToken={fromToken} toToken={toToken} />

      <div id="conversion-tables">
        <ConversionTables id="conversion-tables" fromToken={fromToken} toToken={toToken} />
      </div>

      <SimilarCrypto coin={fromToken}/>

      <MoreConversions 
        id="more"
        advancedOptions={advancedOptions} 
        currencyOptions={currencyOptions} 
      />

    </ConverterContainer>
  );
};

export default Converter;
  