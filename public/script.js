document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const difficultyFiltersContainer = document.getElementById('difficulty-filters');
    const searchButton = document.getElementById('search-button');
    const resultsList = document.getElementById('results-list');

    // Dynamically create checkboxes for difficulty scores 1 through 10
    for (let i = 1; i <= 10; i++) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'difficulty';
        checkbox.value = i;
        checkbox.checked = true; // Start with all difficulties selected

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${i}`));
        difficultyFiltersContainer.appendChild(label);
    }

    // Function to handle the search logic
    const performSearch = () => {
        const query = searchInput.value.trim();
        const selectedDifficulties = Array.from(
            document.querySelectorAll('input[name="difficulty"]:checked')
        ).map(cb => cb.value);

        if (!query) {
            alert('Please enter a search term.');
            return;
        }

        if (selectedDifficulties.length === 0) {
            alert('Please select at least one difficulty level.');
            return;
        }

        const url = `/search?query=${encodeURIComponent(query)}&difficulties=${selectedDifficulties.join(',')}`;

        fetch(url)
            .then(response => response.json())
            .then(data => displayResults(data))
            .catch(error => console.error('Error fetching search results:', error));
    };

    // Function to render the results on the page
    const displayResults = (problems) => {
        resultsList.innerHTML = ''; // Clear previous results

        if (problems.length === 0) {
            resultsList.innerHTML = '<li>No problems found matching your criteria.</li>';
            return;
        }

        problems.forEach(problem => {
            const li = document.createElement('li');

            const link = document.createElement('a');
            link.href = problem.url;
            link.textContent = problem.title;
            link.target = '_blank';

            const badge = document.createElement('span');
            badge.textContent = problem.source;
            badge.classList.add('badge', `source-${problem.source.toLowerCase()}`);

            li.appendChild(link);
            li.appendChild(badge);
            resultsList.appendChild(li);
        });
    };

    // Attach event listeners
    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            performSearch();
        }
    });
});
