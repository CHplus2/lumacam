from django.db import migrations

CATEGORIES = [
    ('Food & Drinks', 'food-drinks', 'Meals, snacks and drinks sold on campus, with daily availability and preorders.', 'utensils', 'orange'),
    ('Student Marketplace', 'marketplace', 'Second-hand items, electronics, books, stationery and student-made products.', 'shopping-bag', 'blue'),
    ('Events & Activities', 'events', 'University events, workshops, competitions, hackathons and seminars.', 'calendar-days', 'violet'),
    ('Surveys & Research', 'surveys', 'Academic surveys, FYP questionnaires, Google Forms and research participation.', 'clipboard-list', 'teal'),
    ('Opportunities', 'opportunities', 'Internships, scholarships, student programmes and volunteering.', 'briefcase-business', 'emerald'),
    ('Other Announcements', 'other', 'General student announcements and campus notices.', 'megaphone', 'rose'),
]


def create_categories(apps, schema_editor):
    Category = apps.get_model('announcements', 'Category')
    for order, (name, slug, desc, icon, color) in enumerate(CATEGORIES):
        Category.objects.update_or_create(
            slug=slug,
            defaults={'name': name, 'description': desc, 'icon': icon, 'color': color, 'sort_order': order},
        )


class Migration(migrations.Migration):
    dependencies = [('announcements', '0001_initial')]
    operations = [migrations.RunPython(create_categories, migrations.RunPython.noop)]
