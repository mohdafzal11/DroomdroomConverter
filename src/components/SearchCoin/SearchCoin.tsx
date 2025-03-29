import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as S from './SearchCoin.styled';
import debounce from 'lodash/debounce';

interface CommonTokenData {
    id: string;
    name: string;
    ticker?: string;
    symbol?: string;
    cmcId: string | number;
}

interface SearchCoinProps {
    coins: CommonTokenData[];
    onSelectToken: (token: CommonTokenData) => void;
    isVisible: boolean;
    onClose: () => void;
}

const SearchCoin: React.FC<SearchCoinProps> = ({ coins, onSelectToken, isVisible, onClose }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState<CommonTokenData[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (coins && coins.length > 0) {
            setResults(coins.slice(0, 10));
        } else {
            setResults([]);
        }
    }, [coins]);

    useEffect(() => {
        if (isVisible && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isVisible]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                onClose();
            }
        }

        if (isVisible) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isVisible, onClose]);

    const debouncedSearch = useCallback(
        debounce(async (term: string) => {
            if (!term.trim()) {
                setResults(coins.slice(0, 10));
                return;
            }

            try {
                const searchResults = coins.filter(coin =>
                    coin.name.toLowerCase().includes(term.toLowerCase()) ||
                    (coin.ticker || coin.symbol || '').toLowerCase().includes(term.toLowerCase())
                ).slice(0, 10);
                
                setResults(searchResults);
            } catch (error) {
                console.error('Search error:', error);
                setResults([]);
            }
        }, 300),
        [coins]
    );

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        debouncedSearch(e.target.value);
    };

    const handleCoinClick = (coin: CommonTokenData) => {
        onSelectToken(coin);
        setSearchTerm('');
        onClose();
    };

    if (!isVisible) return null;

    return (
        <S.SearchPopup ref={wrapperRef}>
            <S.SearchInputWrapper>
                <S.SearchInput
                    ref={inputRef}
                    type="text"
                    placeholder="Search"
                    value={searchTerm}
                    onChange={handleSearch}
                />
                <S.SearchIcon>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 21L15 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </S.SearchIcon>
            </S.SearchInputWrapper>

            <S.ResultsList>
                {results && results.length > 0 ? (
                    results.map((coin) => (
                        <S.ResultItem
                            key={coin.id}
                            onClick={() => handleCoinClick(coin)}
                        >
                            <S.ResultTicker>{coin.ticker || coin.symbol}</S.ResultTicker>
                            <S.ResultName>{coin.name}</S.ResultName>
                        </S.ResultItem>
                    ))
                ) : (
                    <S.NoResults>
                        No results found
                    </S.NoResults>
                )}
            </S.ResultsList>
        </S.SearchPopup>
    );
};

export default SearchCoin;
