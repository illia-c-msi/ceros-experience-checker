document.addEventListener('DOMContentLoaded', () => {
    const checkButton = document.getElementById('checkButton');
    const loader = document.getElementById('loader');
    const resultsDiv = document.getElementById('results');

    // Constants
    const MOTOROLA_DOMAIN = 'view.motorolasolutions';
    const TRUSTARC_SCRIPT_SELECTOR = "script[src*='consent.trustarc.com/notice']";
    const UTAG_SCRIPT_SELECTOR = "script[src*='utag.sync.js']";
    const UTAG_DATA_REGEX = /var utag_data = (\{.*?\});/s;
    const FOUND_TEXT = 'Found';
    const NOT_FOUND_TEXT = 'Not Found';
    const LOADING_DELAY = 1000;

    // Helper function to check if an element exists and get a property
    function getElementAndProperty(selector, property = null) {
        const element = document.querySelector(selector);
        if (element) {
            return property ? element[property] : element;
        }
        return null;
    }

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
                        // Pass the constants as arguments!
                        args: [TRUSTARC_SCRIPT_SELECTOR, UTAG_SCRIPT_SELECTOR, UTAG_DATA_REGEX, FOUND_TEXT, NOT_FOUND_TEXT],
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
    function checkImplementation(trustArcSelector, utagSelector, utagDataRegex, foundText, notFoundText) {
        const results = {};

        // 2.1 Check for TrustArc script
        results.trustArc = document.querySelectorAll(trustArcSelector).length > 0 ? foundText : notFoundText;

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

        // 2.3 Check for utag_data
        function getUtagData() {
            try {
                const headContent = document.querySelector('head')?.innerHTML;
                if (!headContent) return null;

                const match = headContent.match(/var\s+utag_data\s*=\s*(\{.*?\});/s);
                if (!match || !match[1]) return null;

                let jsonString = match[1];

                jsonString = jsonString.replace(/'/g, '"'); // Replace single quotes WITH double quotes
                jsonString = jsonString.replace(/(\w+):/g, '"$1":'); // Ensure keys are wrapped in double quotes
                jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas

                return JSON.parse(jsonString);
            } catch (error) {
                console.error('Failed to parse utag_data:', error, 'Original string:', match ? match[1] : null);
                return null;
            }
        }

        const utagData = getUtagData();
        if (utagData) {
            results.dataLayer = `${foundText}<ul>`;
            for (const key in utagData) {
                if (utagData.hasOwnProperty(key)) {
                    try {
                        results.dataLayer += `<li>${key}: ${JSON.stringify(utagData[key])}</li>`;
                    } catch (stringifyError) {
                        console.error(`Failed to stringify value for key ${key}:`, stringifyError);
                        results.dataLayer += `<li>${key}: Error stringifying value</li>`;
                    }
                }
            }
            results.dataLayer += '</ul>';
        } else {
            results.dataLayer = notFoundText;
        }
        return results;
    }

    function displayResults(results) {
        const resultsDiv = document.getElementById('results');

        // Helper function for result lines with styling
        const resultLine = (label, result) => {
            const statusClass = result.startsWith(FOUND_TEXT) ? 'status-found' : 'status-not-found';
            return `<p>${label}: <span class="${statusClass}">${result}</span></p>`;
        };

        let html = `
          ${resultLine('TrustArc Snippet', results.trustArc)}
          ${resultLine('Tealium Snippet', results.tealium)}
          ${resultLine('Data Layer', results.dataLayer)}
      `;
        resultsDiv.innerHTML = html;
    }
});
