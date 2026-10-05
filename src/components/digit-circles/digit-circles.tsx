import React from 'react';

import './digit-circles.scss';

type ActiveSymbol = {
    exchange_is_open: number;
    is_trading_suspended: number;
    market: string;
    pip_size: number;
    subgroup: string;
    submarket: string;
    trade_count: number;
    underlying_symbol: string;
    underlying_symbol_name: string;
    underlying_symbol_type: string;
};

type ActiveSymbolsResponse = {
    msg_type?: string;
    error?: {
        code?: string;
        message?: string;
    };
    active_symbols?: ActiveSymbol[];
};

type HistoryResponse = {
    msg_type?: string;
    error?: {
        code?: string;
        message?: string;
    };
    history?: {
        prices?: Array<number | string>;
        times?: number[];
    };
    pip_size?: number;
};

type TickResponse = {
    msg_type?: string;
    error?: {
        code?: string;
        message?: string;
    };
    tick?: {
        ask?: number;
        bid?: number;
        epoch?: number;
        id?: string;
        pip_size?: number;
        quote?: number | string;
        symbol?: string;
    };
    subscription?: {
        id?: string;
    };
};

type DigitStat = {
    digit: number;
    count: number;
    percentage: number;
};

type RankType = 'highest' | 'second' | 'lowest' | 'neutral';

const WS_URL =
    'wss://api.derivws.com/trading/v1/options/ws/public';

const DEFAULT_TICK_WINDOW = 100;

const TICK_WINDOWS = [60, 100, 500];

const DigitCircles = () => {
    const [symbols, setSymbols] = React.useState<ActiveSymbol[]>([]);
    const [selectedSymbol, setSelectedSymbol] =
        React.useState('');

    const [tickWindow, setTickWindow] =
        React.useState(DEFAULT_TICK_WINDOW);

    const [ticks, setTicks] = React.useState<number[]>([]);

    const [isConnected, setIsConnected] =
        React.useState(false);

    const [isLoading, setIsLoading] =
        React.useState(true);

    const [errorMessage, setErrorMessage] =
        React.useState('');

    const [pipSize, setPipSize] =
        React.useState<number | null>(null);

    const websocketRef =
        React.useRef<WebSocket | null>(null);

    const subscriptionIdRef =
        React.useRef<string | null>(null);

    const requestIdRef =
        React.useRef(1);

    const selectedSymbolRef =
        React.useRef('');

    const tickWindowRef =
        React.useRef(DEFAULT_TICK_WINDOW);

    const symbolsRef =
        React.useRef<ActiveSymbol[]>([]);

    const pipSizeRef =
        React.useRef<number | null>(null);

    const getNextRequestId =
        React.useCallback(() => {
            const requestId =
                requestIdRef.current;

            requestIdRef.current += 1;

            return requestId;
        }, []);

    const isVolatilityIndex =
        React.useCallback(
            (symbol: ActiveSymbol) => {
                const market =
                    symbol.market?.toLowerCase() ?? '';

                const submarket =
                    symbol.submarket?.toLowerCase() ?? '';

                const subgroup =
                    symbol.subgroup?.toLowerCase() ?? '';

                const symbolType =
                    symbol.underlying_symbol_type
                        ?.toLowerCase() ?? '';

                return (
                    market === 'synthetic_index' ||
                    symbolType === 'synthetic_index' ||
                    submarket === 'random_index' ||
                    subgroup === 'random_index'
                );
            },
            []
        );

    const formatQuote =
        React.useCallback(
            (
                quote: number | string,
                precision: number
            ) => {
                const numericQuote =
                    Number(quote);

                if (!Number.isFinite(numericQuote)) {
                    return null;
                }

                const safePrecision = Math.max(
                    0,
                    Math.min(
                        10,
                        Math.round(precision)
                    )
                );

                return numericQuote.toFixed(
                    safePrecision
                );
            },
            []
        );

    const getLastDigit =
        React.useCallback(
            (
                quote: number | string,
                precision: number
            ) => {
                const formattedQuote =
                    formatQuote(
                        quote,
                        precision
                    );

                if (formattedQuote === null) {
                    return null;
                }

                const decimalIndex =
                    formattedQuote.indexOf('.');

                if (decimalIndex === -1) {
                    const digitsOnly =
                        formattedQuote.replace(
                            /\D/g,
                            ''
                        );

                    if (!digitsOnly) {
                        return null;
                    }

                    return Number(
                        digitsOnly.slice(-1)
                    );
                }

                const decimalPart =
                    formattedQuote.slice(
                        decimalIndex + 1
                    );

                if (!decimalPart.length) {
                    return 0;
                }

                return Number(
                    decimalPart.slice(-1)
                );
            },
            [formatQuote]
        );

    const addDigitFromQuote =
        React.useCallback(
            (
                quote: number | string,
                precision: number
            ) => {
                const digit =
                    getLastDigit(
                        quote,
                        precision
                    );

                if (
                    digit === null ||
                    digit < 0 ||
                    digit > 9
                ) {
                    return;
                }

                setTicks(
                    (currentTicks) => {
                        const updatedTicks = [
                            ...currentTicks,
                            digit,
                        ];

                        return updatedTicks.slice(
                            -tickWindowRef.current
                        );
                    }
                );
            },
            [getLastDigit]
        );

    const forgetSubscription =
        React.useCallback(() => {
            const websocket =
                websocketRef.current;

            const subscriptionId =
                subscriptionIdRef.current;

            if (
                !websocket ||
                websocket.readyState !==
                    WebSocket.OPEN ||
                !subscriptionId
            ) {
                return;
            }

            websocket.send(
                JSON.stringify({
                    forget: subscriptionId,
                    req_id: getNextRequestId(),
                })
            );

            subscriptionIdRef.current = null;
        }, [getNextRequestId]);

    const sendHistoryRequest =
        React.useCallback(
            (symbol: string) => {
                const websocket =
                    websocketRef.current;

                if (
                    !websocket ||
                    websocket.readyState !==
                        WebSocket.OPEN
                ) {
                    return;
                }

                forgetSubscription();

                setIsLoading(true);
                setErrorMessage('');
                setTicks([]);
                setPipSize(null);

                pipSizeRef.current = null;

                websocket.send(
                    JSON.stringify({
                        ticks_history: symbol,
                        adjust_start_time: 1,
                        count:
                            tickWindowRef.current,
                        end: 'latest',
                        style: 'ticks',
                        subscribe: 0,
                        req_id:
                            getNextRequestId(),
                    })
                );
            },
            [
                forgetSubscription,
                getNextRequestId,
            ]
        );

    const subscribeToTicks =
        React.useCallback(
            (symbol: string) => {
                const websocket =
                    websocketRef.current;

                if (
                    !websocket ||
                    websocket.readyState !==
                        WebSocket.OPEN
                ) {
                    return;
                }

                websocket.send(
                    JSON.stringify({
                        ticks: symbol,
                        subscribe: 1,
                        req_id:
                            getNextRequestId(),
                    })
                );
            },
            [getNextRequestId]
        );

    const connectWebSocket =
        React.useCallback(() => {
            const websocket =
                new WebSocket(WS_URL);

            websocketRef.current =
                websocket;

            websocket.onopen = () => {
                setIsConnected(true);
                setErrorMessage('');

                websocket.send(
                    JSON.stringify({
                        active_symbols:
                            'brief',
                        req_id:
                            getNextRequestId(),
                    })
                );
            };

            websocket.onmessage = (
                event
            ) => {
                try {
                    const data:
                        | ActiveSymbolsResponse
                        | HistoryResponse
                        | TickResponse =
                        JSON.parse(
                            event.data
                        );

                    if (
                        'error' in data &&
                        data.error
                    ) {
                        setErrorMessage(
                            data.error
                                .message ||
                                'Deriv returned an error.'
                        );

                        setIsLoading(false);

                        return;
                    }

                    if (
                        data.msg_type ===
                        'active_symbols'
                    ) {
                        const response =
                            data as ActiveSymbolsResponse;

                        const volatilitySymbols =
                            (
                                response.active_symbols ??
                                []
                            )
                                .filter(
                                    isVolatilityIndex
                                )
                                .filter(
                                    (symbol) =>
                                        symbol.exchange_is_open ===
                                            1 &&
                                        symbol.is_trading_suspended ===
                                            0
                                )
                                .sort(
                                    (a, b) =>
                                        a.underlying_symbol_name.localeCompare(
                                            b.underlying_symbol_name
                                        )
                                );

                        symbolsRef.current =
                            volatilitySymbols;

                        setSymbols(
                            volatilitySymbols
                        );

                        if (
                            volatilitySymbols.length ===
                            0
                        ) {
                            setErrorMessage(
                                'No active Volatility Indices were found.'
                            );

                            setIsLoading(false);

                            return;
                        }

                        const currentSelected =
                            selectedSymbolRef.current;

                        const stillAvailable =
                            volatilitySymbols.some(
                                (symbol) =>
                                    symbol.underlying_symbol ===
                                    currentSelected
                            );

                        const nextSymbol =
                            stillAvailable
                                ? currentSelected
                                : volatilitySymbols[0]
                                      .underlying_symbol;

                        selectedSymbolRef.current =
                            nextSymbol;

                        setSelectedSymbol(
                            nextSymbol
                        );

                        return;
                    }

                    if (
                        data.msg_type ===
                        'history'
                    ) {
                        const response =
                            data as HistoryResponse;

                        const prices =
                            response.history
                                ?.prices ?? [];

                        const symbolDetails =
                            symbolsRef.current.find(
                                (symbol) =>
                                    symbol.underlying_symbol ===
                                    selectedSymbolRef.current
                            );

                        const historyPipSize =
                            response.pip_size ??
                            symbolDetails?.pip_size ??
                            0;

                        pipSizeRef.current =
                            historyPipSize;

                        setPipSize(
                            historyPipSize
                        );

                        const historyDigits =
                            prices
                                .map(
                                    (price) =>
                                        getLastDigit(
                                            price,
                                            historyPipSize
                                        )
                                )
                                .filter(
                                    (
                                        digit
                                    ): digit is number =>
                                        digit !==
                                            null &&
                                        digit >= 0 &&
                                        digit <= 9
                                );

                        setTicks(
                            historyDigits.slice(
                                -tickWindowRef.current
                            )
                        );

                        setIsLoading(false);

                        /*
                         * Subscribe only after
                         * the history has arrived.
                         * This prevents a live tick
                         * from being overwritten
                         * by the history response.
                         */
                        subscribeToTicks(
                            selectedSymbolRef.current
                        );

                        return;
                    }

                    if (
                        data.msg_type ===
                        'tick'
                    ) {
                        const response =
                            data as TickResponse;

                        const tick =
                            response.tick;

                        if (
                            !tick ||
                            tick.quote ===
                                undefined
                        ) {
                            return;
                        }

                        if (
                            tick.symbol &&
                            tick.symbol !==
                                selectedSymbolRef.current
                        ) {
                            return;
                        }

                        const incomingPipSize =
                            tick.pip_size ??
                            pipSizeRef.current ??
                            0;

                        pipSizeRef.current =
                            incomingPipSize;

                        setPipSize(
                            incomingPipSize
                        );

                        addDigitFromQuote(
                            tick.quote,
                            incomingPipSize
                        );

                        if (
                            response.subscription
                                ?.id
                        ) {
                            subscriptionIdRef.current =
                                response
                                    .subscription
                                    .id;
                        }
                    }
                } catch {
                    setErrorMessage(
                        'Unable to read data from the Deriv WebSocket.'
                    );

                    setIsLoading(false);
                }
            };

            websocket.onerror = () => {
                setIsConnected(false);
                setIsLoading(false);

                setErrorMessage(
                    'Unable to connect to Deriv market data.'
                );
            };

            websocket.onclose = () => {
                setIsConnected(false);
            };

            return websocket;
        }, [
            addDigitFromQuote,
            getLastDigit,
            getNextRequestId,
            isVolatilityIndex,
            subscribeToTicks,
        ]);

    React.useEffect(() => {
        const websocket =
            connectWebSocket();

        return () => {
            if (
                websocket.readyState ===
                    WebSocket.OPEN ||
                websocket.readyState ===
                    WebSocket.CONNECTING
            ) {
                websocket.close();
            }

            websocketRef.current = null;
            subscriptionIdRef.current =
                null;
        };
    }, [connectWebSocket]);

    React.useEffect(() => {
        tickWindowRef.current =
            tickWindow;

        if (!selectedSymbol) {
            return;
        }

        selectedSymbolRef.current =
            selectedSymbol;

        const websocket =
            websocketRef.current;

        if (
            !websocket ||
            websocket.readyState !==
                WebSocket.OPEN
        ) {
            return;
        }

        sendHistoryRequest(
            selectedSymbol
        );
    }, [
        selectedSymbol,
        tickWindow,
        sendHistoryRequest,
    ]);

    const handleSymbolChange =
        (
            event: React.ChangeEvent<HTMLSelectElement>
        ) => {
            const nextSymbol =
                event.target.value;

            selectedSymbolRef.current =
                nextSymbol;

            setSelectedSymbol(
                nextSymbol
            );
        };

    const handleTickWindowChange =
        (
            event: React.ChangeEvent<HTMLSelectElement>
        ) => {
            const nextWindow =
                Number(
                    event.target.value
                );

            if (
                !TICK_WINDOWS.includes(
                    nextWindow
                )
            ) {
                return;
            }

            tickWindowRef.current =
                nextWindow;

            setTickWindow(
                nextWindow
            );
        };

    const digitStats =
        React.useMemo<DigitStat[]>(
            () => {
                const counts =
                    Array.from(
                        { length: 10 },
                        () => 0
                    );

                ticks.forEach(
                    (digit) => {
                        if (
                            digit >= 0 &&
                            digit <= 9
                        ) {
                            counts[digit] +=
                                1;
                        }
                    }
                );

                const total =
                    ticks.length;

                return counts.map(
                    (count, digit) => ({
                        digit,
                        count,
                        percentage:
                            total > 0
                                ? (count /
                                      total) *
                                  100
                                : 0,
                    })
                );
            },
            [ticks]
        );

    const rankings =
        React.useMemo(() => {
            const sorted = [
                ...digitStats,
            ].sort(
                (a, b) =>
                    b.percentage -
                    a.percentage
            );

            return {
                highest:
                    sorted[0]?.digit,
                second:
                    sorted[1]?.digit,
                lowest:
                    sorted[
                        sorted.length - 1
                    ]?.digit,
            };
        }, [digitStats]);

    const getRank = (
        digit: number
    ): RankType => {
        if (
            digit ===
            rankings.highest
        ) {
            return 'highest';
        }

        if (
            digit ===
            rankings.second
        ) {
            return 'second';
        }

        if (
            digit ===
            rankings.lowest
        ) {
            return 'lowest';
        }

        return 'neutral';
    };

    const selectedSymbolDetails =
        symbols.find(
            (symbol) =>
                symbol.underlying_symbol ===
                selectedSymbol
        );

    return (
        <section className="digit-circles">
            <div className="digit-circles__header">
                <div>
                    <h2 className="digit-circles__title">
                        Digit Circles
                    </h2>

                    <p className="digit-circles__subtitle">
                        Live Volatility Index
                        digit distribution
                    </p>
                </div>

                <div
                    className={`digit-circles__status ${
                        isConnected
                            ? 'digit-circles__status--connected'
                            : 'digit-circles__status--disconnected'
                    }`}
                >
                    <span className="digit-circles__status-dot" />

                    {isConnected
                        ? 'Live'
                        : 'Disconnected'}
                </div>
            </div>

            <div className="digit-circles__controls">
                <label className="digit-circles__control">
                    <span>
                        Volatility Index
                    </span>

                    <select
                        value={
                            selectedSymbol
                        }
                        onChange={
                            handleSymbolChange
                        }
                        disabled={
                            symbols.length ===
                            0
                        }
                    >
                        {symbols.length ===
                        0 ? (
                            <option value="">
                                Loading indices...
                            </option>
                        ) : (
                            symbols.map(
                                (symbol) => (
                                    <option
                                        key={
                                            symbol.underlying_symbol
                                        }
                                        value={
                                            symbol.underlying_symbol
                                        }
                                    >
                                        {
                                            symbol.underlying_symbol_name
                                        }
                                    </option>
                                )
                            )
                        )}
                    </select>
                </label>

                <label className="digit-circles__control">
                    <span>Ticks</span>

                    <select
                        value={tickWindow}
                        onChange={
                            handleTickWindowChange
                        }
                    >
                        {TICK_WINDOWS.map(
                            (window) => (
                                <option
                                    key={
                                        window
                                    }
                                    value={
                                        window
                                    }
                                >
                                    {window}
                                </option>
                            )
                        )}
                    </select>
                </label>
            </div>

            {selectedSymbolDetails && (
                <div className="digit-circles__market-info">
                    <span>
                        {
                            selectedSymbolDetails.underlying_symbol
                        }
                    </span>

                    <span>
                        Precision:{' '}
                        {pipSize ??
                            selectedSymbolDetails.pip_size}
                    </span>

                    <span>
                        Tracking:{' '}
                        {ticks.length}/
                        {tickWindow}
                    </span>
                </div>
            )}

            {errorMessage && (
                <div className="digit-circles__error">
                    {errorMessage}
                </div>
            )}

            <div className="digit-circles__body">
                {digitStats.map(
                    (stat) => {
                        const rank =
                            getRank(
                                stat.digit
                            );

                        return (
                            <div
                                className={`digit-circles__row digit-circles__row--${rank}`}
                                key={
                                    stat.digit
                                }
                            >
                                <div
                                    className={`digit-circles__digit digit-circles__digit--${rank}`}
                                >
                                    {
                                        stat.digit
                                    }
                                </div>

                                <div className="digit-circles__details">
                                    <div className="digit-circles__numbers">
                                        <strong>
                                            {stat.percentage.toFixed(
                                                1
                                            )}
                                            %
                                        </strong>

                                        <span>
                                            {
                                                stat.count
                                            }{' '}
                                            ticks
                                        </span>
                                    </div>

                                    <div className="digit-circles__bar">
                                        <div
                                            className={`digit-circles__bar-fill digit-circles__bar-fill--${rank}`}
                                            style={{
                                                width: `${Math.min(
                                                    stat.percentage,
                                                    100
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    }
                )}
            </div>

            <div className="digit-circles__legend">
                <span>
                    <i className="digit-circles__legend-dot digit-circles__legend-dot--highest" />
                    Highest
                </span>

                <span>
                    <i className="digit-circles__legend-dot digit-circles__legend-dot--second" />
                    Second
                </span>

                <span>
                    <i className="digit-circles__legend-dot digit-circles__legend-dot--lowest" />
                    Lowest
                </span>
            </div>

            {isLoading && (
                <div className="digit-circles__loading">
                    Loading market data...
                </div>
            )}
        </section>
    );
};

export default DigitCircles;
