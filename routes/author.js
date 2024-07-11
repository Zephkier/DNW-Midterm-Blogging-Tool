// Import and setup modules
const express = require("express");
const { check, validationResult } = require("express-validator");
const { db } = require("../utils/db.js");
const {
    // Format
    errorPage,
    return_ConversionFromUTC_ToLocalDatetime,
    return_StrippedAnd_ShortenedString,
    if_UserLoggedIn,
    if_UserHasABlog,
    if_UserHasNoBlog,
    if_ArticleBelongsToBlog,
} = require("../utils/middleware.js");

const router = express.Router();

// Ensure user is logged in and has a blog to access these pages!

// Home (author), view all articles
router.get("/", if_UserLoggedIn, if_UserHasABlog, (request, response) => {
    let queryForArticlesFromBlog = `
            SELECT * FROM articles
            WHERE blog_id = ?
            ORDER BY date_modified DESC`;
    db.all(queryForArticlesFromBlog, [request.blogInfo.id], (err, articlesFromBlog) => {
        if (err) return errorPage(response, 500, "A001", err);
        // Order is [draft], [published], [deleted]
        let allArticles = [[], [], []];
        articlesFromBlog.forEach((article) => {
            // Setup body_plain as it is empty initially
            article.body_plain = return_StrippedAnd_ShortenedString(article.body);
            // Use <br> so it can be applied in frontend, must use <%- %>
            article.date_created = return_ConversionFromUTC_ToLocalDatetime(article.date_created).replace().replace(", ", "<br>");
            article.date_modified = return_ConversionFromUTC_ToLocalDatetime(article.date_modified).replace(", ", "<br>");
            // Filter into different categories
            if (article.category == "draft") allArticles[0].push(article);
            else if (article.category == "published") allArticles[1].push(article);
            else if (article.category == "deleted") allArticles[2].push(article);
        });
        return response.render("author/home.ejs", {
            pageName: "Home (author)",
            user: request.session.user,
            blog: request.blogInfo,
            articleCategories: ["Draft", "Published", "Deleted"],
            tableHeaders: ["Title", "Subtitle", "Views", "Likes", "Date created", "Date modified", "Actions"],
            allArticles: allArticles,
        });
    });
});

// Action buttons not including "Edit" button at .get("/article")
router.post("/", (request, response) => {
    let queryToUpdateOrDelete = "";
    if (request.body.thisReturnsItsValue == "delete-permanently") queryToUpdateOrDelete = "DELETE from articles WHERE id = ?";
    else queryToUpdateOrDelete = `UPDATE articles SET category = '${request.body.thisReturnsItsValue}' WHERE id = ?`;
    db.run(queryToUpdateOrDelete, [request.body.chosenId], (err) => {
        if (err) return errorPage(response, 500, "A002", err);
        return response.redirect("/author");
    });
});

// Create blog (note that this uses HasNoBlog()!)
router.get("/create-blog", if_UserLoggedIn, if_UserHasNoBlog, (request, response) => {
    let queryForBlogInfo = `
        SELECT blogs.id, blogs.title, users.display_name
        FROM blogs JOIN users
        ON blogs.user_id = users.id
        WHERE users.id = ?`;
    db.get(queryForBlogInfo, [request.session.user.id], (err, blogInfo) => {
        if (err) return errorPage(response, 500, "A003", err);
        if (blogInfo) return response.redirect("/author");
        return response.render("author/create-blog.ejs", {
            pageName: "Create blog",
            user: request.session.user,
            formInputStored: {},
            formErrors: [],
        });
    });
});

router.post("/create-blog", [check("createBlogTitle", "Title must have at least 1 character").trim().notEmpty()], (request, response) => {
    const formErrors = validationResult(request); // Returns {formatter = [<stuff inside>], errors = [<stuff inside>]}
    // If validation is bad, then re-render page with errors
    if (!formErrors.isEmpty()) {
        return response.render("author/create-blog.ejs", {
            pageName: "Create blog",
            user: request.session.user,
            formInputStored: { createBlogTitle: request.body.createBlogTitle },
            formErrors: formErrors.errors, // Returns [{type, value, msg, path, location}]
        });
    } else {
        let queryToCreateBlogTitle = "INSERT INTO blogs (title, user_id) VALUES (?, ?)";
        let params = [request.body.createBlogTitle, request.session.user.id];
        db.run(queryToCreateBlogTitle, params, (err) => {
            if (err) return errorPage(response, 500, "A004", err);
            return response.redirect("/author");
        });
    }
});

// Settings
router.get("/settings", if_UserLoggedIn, if_UserHasABlog, (request, response) => {
    return response.render("author/settings.ejs", {
        pageName: "Settings",
        user: request.session.user,
        formInputStored: {
            blogTitle: request.blogInfo.title,
            displayName: request.blogInfo.display_name,
        },
        formErrors: [],
    });
});

router.post(
    "/settings",
    [
        // Format
        check("blogTitle", "Title must have at least 1 character").trim().notEmpty(),
        check("displayName", "Name must have at least 1 character").trim().notEmpty(),
    ],
    (request, response) => {
        const formErrors = validationResult(request); // Returns {formatter = [<stuff inside>], errors = [<stuff inside>]}
        // If validation is bad, then re-render page with errors
        if (!formErrors.isEmpty()) {
            return response.render("author/settings.ejs", {
                pageName: "Settings",
                user: request.session.user,
                formInputStored: {
                    blogTitle: request.body.blogTitle,
                    displayName: request.body.displayName,
                },
                formErrors: formErrors.errors, // Returns [{type, value, msg, path, location}]
            });
        } else {
            let queryToUpdateBlogTitle = "UPDATE blogs SET title = ? WHERE user_id = ?";
            let params = [request.body.blogTitle, request.session.user.id];
            db.run(queryToUpdateBlogTitle, params, (err) => {
                if (err) return errorPage(response, 500, "A005", err);
                let queryToUpdateDisplayName = "UPDATE users SET display_name = ? WHERE id = ?";
                db.run(queryToUpdateDisplayName, [request.body.displayName, request.session.user.id], (err) => {
                    if (err) return errorPage(response, 500, "A006", err);
                    return response.redirect("/author");
                });
            });
        }
    }
);

// Article, create new article by default
router.get("/article", if_UserLoggedIn, if_UserHasABlog, (request, response) => {
    return response.render("author/article.ejs", {
        pageName: "Create new article",
        user: request.session.user,
        formInputStored: {},
        formErrors: [],
    });
});

router.post(
    "/article",
    [
        // Format
        check("articleTitle", "Title must have at least 1 character").trim().notEmpty(),
        check("articleBody", "Body must have at least 1 character").trim().notEmpty(),
    ],
    (request, response) => {
        const formErrors = validationResult(request); // Returns {formatter = [<stuff inside>], errors = [<stuff inside>]}
        // If validation is bad, then re-render page with errors
        if (!formErrors.isEmpty()) {
            return response.render("author/article.ejs", {
                pageName: "Create new article",
                user: request.session.user,
                formInputStored: request.body,
                formErrors: formErrors.errors, // Returns [{type, value, msg, path, location}]
            });
        } else {
            // Do this first to get blogs.id
            let queryForBlogId = "SELECT id FROM blogs WHERE user_id = ?";
            db.get(queryForBlogId, [request.session.user.id], (err, blogId) => {
                if (err) return errorPage(response, 500, "A007", err);
                if (!blogId) return errorPage(response, 400, "A008", new Error("Blog not found"));
                // So that article can be inserted into the correct blog via blogs.id
                let queryToInsertArticle = `
                INSERT INTO
                    articles (category, title, subtitle, body, body_plain, blog_id)
                VALUES
                    (?, ?, ?, ?, ?, ?)`;
                let params = [
                    request.body.thisReturnsItsValue,
                    request.body.articleTitle,
                    request.body.articleSubtitle,
                    request.body.articleBody,
                    return_StrippedAnd_ShortenedString(request.body.articleBody), // Get its plain version
                    blogId.id,
                ];
                db.run(queryToInsertArticle, params, (err) => {
                    if (err) return errorPage(response, 500, "A009", err);
                    return response.redirect("/author");
                });
            });
        }
    }
);

// Article, edit draft/published article (:chosenId is retrieved upon clicking "Edit" button)
router.get("/article/:chosenId", if_UserLoggedIn, if_UserHasABlog, if_ArticleBelongsToBlog, (request, response) => {
    let queryForChosenArticle = "SELECT * FROM articles WHERE id = ?";
    let chosenId = request.params.chosenId; // Get param from URL
    db.get(queryForChosenArticle, [chosenId], (err, chosenArticle) => {
        if (err) return errorPage(response, 500, "A010", err);
        response.render("author/article.ejs", {
            pageName: `Edit ${chosenArticle.category} article`, // Differentiate editing draft or published articles
            user: request.session.user,
            formInputStored: {
                chosenId: chosenId,
                articleTitle: chosenArticle.title,
                articleSubtitle: chosenArticle.subtitle,
                articleBody: chosenArticle.body,
            },
            formErrors: [],
        });
    });
});

router.post(
    "/article/:chosenId",
    [
        // Format
        check("articleTitle", "Title must have at least 1 character").trim().notEmpty(),
        check("articleBody", "Body must have at least 1 character").trim().notEmpty(),
    ],
    (request, response) => {
        const formErrors = validationResult(request); // Returns {formatter = [<stuff inside>], errors = [<stuff inside>]}
        // If validation is bad, then re-render page with errors
        if (!formErrors.isEmpty()) {
            let queryForChosenArticle = "SELECT * FROM articles WHERE id = ?";
            let chosenId = request.params.chosenId; // Get param from URL
            db.get(queryForChosenArticle, [chosenId], (err, chosenArticle) => {
                if (err) return errorPage(response, 500, "A011", err);
                return response.render("author/article.ejs", {
                    pageName: `Edit ${chosenArticle.category} article`, // Differentiate editing draft or published articles
                    user: request.session.user,
                    formInputStored: {
                        chosenId: chosenId,
                        articleTitle: request.body.articleTitle,
                        articleSubtitle: request.body.articleSubtitle,
                        articleBody: request.body.articleBody,
                    },
                    formErrors: formErrors.errors, // Returns [{type, value, msg, path, location}]
                });
            });
        } else {
            // Do this first to get blogs.id
            let queryForBlogId = "SELECT id FROM blogs WHERE user_id = ?";
            db.get(queryForBlogId, [request.session.user.id], (err, blogId) => {
                if (err) return errorPage(response, 500, "A012", err);
                if (!blogId) return errorPage(response, 400, "A013", new Error("Blog not found"));
                // So that article can be inserted into the correct blog via blogs.id
                let queryToUpdateArticle = `
                    UPDATE articles
                    SET
                        category = ?, title = ?, subtitle = ?, body = ?, body_plain = ?,
                        date_modified = CURRENT_TIMESTAMP, blog_id = ?
                    WHERE
                        id = ?`;
                let params = [
                    request.body.thisReturnsItsValue,
                    request.body.articleTitle,
                    request.body.articleSubtitle,
                    request.body.articleBody,
                    return_StrippedAnd_ShortenedString(request.body.articleBody), // Get its plain version
                    blogId.id,
                    request.params.chosenId,
                ];
                db.run(queryToUpdateArticle, params, (err) => {
                    if (err) return errorPage(response, 500, "A014", err);
                    return response.redirect("/author");
                });
            });
        }
    }
);

// After every possible page above, do error-handling for invalid URLs
router.get("/:everythingElse", (request, response) => {
    return response.redirect("/author");
});

// Export module containing the following so external files can access it
module.exports = router;
