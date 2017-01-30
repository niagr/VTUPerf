-- Calculate aggregate of all semesters
SELECT usn, AVG(sem_percentage)
FROM (
	SELECT usn, sem, ((SUM(marks)/900)*100) AS sem_percentage
	FROM Results
	WHERE attemp = 1
	GROUP BY usn, sem;
) GROUP BY usn;
