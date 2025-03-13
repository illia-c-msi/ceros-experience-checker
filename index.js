document.addEventListener('DOMContentLoaded', () => {
    const checkButton = document.getElementById('checkButton');
    const loader = document.getElementById('loader');
    const resultsDiv = document.getElementById('results');

    // Constants
    const MOTOROLA_DOMAIN = 'view.motorolasolutions';
    const TRUSTARC_SCRIPT_SELECTOR = "script[src*='consent.trustarc.com/notice']";
    const UTAG_SCRIPT_SELECTOR = "script[src*='utag.sync.js']";
    const UTAG_DATA_REGEX = /<script[^>]*>\s*var\s+utag_data\s*=\s*(\{.*?\});/s;
    const CEROS_META_SELECTOR = "meta[name*='ceros_']";
    const FOUND_TEXT = 'Found';
    const NOT_FOUND_TEXT = 'Not Found';
    const LOADING_DELAY = 1000;

    // Function to check the URL and enable/disable the button
    function checkUrl() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            const isMotorolaSite = currentTab?.url?.includes(MOTOROLA_DOMAIN) ?? false;
            checkButton.disabled = !isMotorolaSite;
        });
    }

    // Call checkUrl when the popup is opened
    checkUrl();

    checkButton.addEventListener('click', () => {
        loader.style.display = 'block';
        resultsDiv.innerHTML = '';

        setTimeout(() => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const currentTab = tabs[0];
                if (!currentTab) {
                    resultsDiv.innerHTML = 'Error: No active tab found.';
                    loader.style.display = 'none';
                    return;
                }
                const tabId = currentTab.id;

                chrome.scripting.executeScript(
                    {
                        target: { tabId: tabId },
                        func: checkImplementation,
                        args: [
                            TRUSTARC_SCRIPT_SELECTOR,
                            UTAG_SCRIPT_SELECTOR,
                            UTAG_DATA_REGEX,
                            CEROS_META_SELECTOR,
                            FOUND_TEXT,
                            NOT_FOUND_TEXT,
                        ],
                    },
                    (results) => {
                        loader.style.display = 'none';
                        if (results && results[0] && results[0].result) {
                            displayResults(results[0].result);
                        } else {
                            resultsDiv.innerHTML = 'Error: Could not retrieve results.';
                        }
                    },
                );
            });
        }, LOADING_DELAY);
    });

    // checkImplementation
    function checkImplementation(
        trustArcSelector,
        utagSelector,
        utagDataRegex,
        cerosMetaSelector,
        foundText,
        notFoundText,
    ) {
        const results = {};

        // 2.1 Check for TrustArc script
        results.trustArc = document.querySelectorAll(trustArcSelector).length > 0 ? foundText : notFoundText;
        console.log('TrustArc Check:', results.trustArc);

        // 2.2 Check for utag script
        const utagScript = document.querySelector(utagSelector);
        if (utagScript) {
            results.tealium = foundText;
            try {
                const profile = utagScript.src.split('utag/')[1].split('/utag.sync')[0];
                results.tealium += ` (${profile})`;
            } catch (error) {
                console.error('Failed to parse Tealium profile:', error);
                results.tealium += ' (Error parsing profile)';
            }
        } else {
            results.tealium = notFoundText;
        }
        console.log('Tealium Check:', results.tealium);
        // 2.3 Check for utag_data
        function getUtagData() {
            console.log('getUtagData called');
            try {
                const fullHtml = document.querySelector('head').innerHTML;
                console.log('fullHtml:', fullHtml);
                if (!fullHtml) {
                    console.log('fullHtml is null or undefined. Returning null.');
                    return null;
                }

                const match = fullHtml.match(/<script[^>]*>\s*var\s+utag_data\s*=\s*(\{.*?\});/s);
                console.log('utagDataRegex match:', match);
                if (!match || !match[1]) {
                    console.log('utag_data not found using regex. Returning null.');
                    return null;
                }

                let jsonString = match[1];
                console.log('Extracted JSON string:', jsonString);

                jsonString = jsonString.replace(/'/g, '"'); // Replace single quotes
                console.log('JSON string after replacing single quotes:', jsonString);
                jsonString = jsonString.replace(/(\w+):/g, '"$1":'); // Ensure keys are double-quoted
                console.log('JSON string after quoting keys:', jsonString);
                jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
                console.log('JSON string after removing trailing commas:', jsonString);
                const parsedData = JSON.parse(jsonString);
                console.log('Parsed utag_data:', parsedData);
                return parsedData;
            } catch (error) {
                console.error('Failed to parse utag_data:', error, 'Original string:', match ? match[1] : null);
                return null;
            }
        }
        const utagData = getUtagData();
        console.log('utagData returned:', utagData);

        if (utagData) {
            results.dataLayer = `${foundText}<table>`;
            for (const key in utagData) {
                if (utagData.hasOwnProperty(key)) {
                    try {
                        results.dataLayer += `<tr><td>${key}</td><td>${JSON.stringify(utagData[key])}</td></tr>`;
                    } catch (stringifyError) {
                        console.error(`Failed to stringify value for key ${key}:`, stringifyError);
                        results.dataLayer += `<tr><td>${key}</td><td>Error stringifying value</td></tr>`;
                    }
                }
            }
            results.dataLayer += '</table>';
        } else {
            results.dataLayer = notFoundText;
        }
        console.log('Data Layer Result:', results.dataLayer);

        // 2.4 Check for Ceros meta tags
        const cerosMetaTags = document.querySelectorAll(cerosMetaSelector);
        if (cerosMetaTags.length > 0) {
            results.ceros = `${foundText} (${cerosMetaTags.length})<table>`;
            cerosMetaTags.forEach((tag) => {
                try {
                    const name = tag.getAttribute('name').replace('ceros_', '');
                    const content = tag.getAttribute('content');
                    results.ceros += `<tr><td>${name}</td><td>${content}</td></tr>`;
                } catch (error) {
                    console.error('Failed to parse Ceros meta tag:', error);
                    results.ceros += `<tr><td>Error parsing tag</td><td></td></tr>`;
                }
            });
            results.ceros += '</table>';
        } else {
            results.ceros = notFoundText;
        }
        console.log('Ceros Check:', results.ceros);
        return results;
    }

    function displayResults(results) {
        console.log('displayResults called with results:', results);
        const resultsDiv = document.getElementById('results');

        // Helper function - takes the label and the FULL result string
        const resultLine = (label, result) => {
            const statusClass = result.startsWith(FOUND_TEXT) ? 'status-found' : 'status-not-found';
            return `<p>${label}: <span class="${statusClass}">${result}</span></p>`;
        };

        let html = `
            ${resultLine('TrustArc Snippet', results.trustArc)}
            ${resultLine('Tealium Snippet', results.tealium)}
            ${resultLine('Data Layer', results.dataLayer)}
            ${results.ceros ? resultLine('Ceros Meta Tags', results.ceros) : ''}
        `;
        resultsDiv.innerHTML = html;
    }
});
